#!/usr/bin/env python3
"""Evaluate Lune AI on this device with the real model, in a real browser.

Needs network access to huggingface.co (model files) and cdn.jsdelivr.net
(transformers.js and its WebAssembly). Serve the site on 8137 first.

    python3 scripts/device_ai_eval.py [webgpu|wasm] [--chrome] [--headed] [--model ID] [--apply]

    --chrome   use the Google Chrome installed on this computer (best for WebGPU on a Mac)
    --headed   show the browser window while it runs
    --model    try another model, e.g. onnx-community/Qwen2.5-0.5B-Instruct
    --apply    if every check passes, write the measured sizes, the model and
               verified: true into frontend/ai-device.js (nothing is written otherwise)

It
  1. measures the bytes each build downloads, from the Hugging Face file list
     (paste them into MODEL.builds in frontend/ai-device.js);
  2. loads the model inside Lune in Chromium and times it;
  3. asks grounded questions about Für Elise through the same system prompt
     and buildContext() that Ask Lune uses, and checks each answer against
     the context it was given: note names, bar numbers and fingers must come
     from the context, a missing fact (an opus number) must be declined, and
     the model must not claim to have heard the pianist;
  4. reports time to load, time to first word and words per second.

Lune AI stays off (MODEL.verified = false) unless every check passes and the
speed is acceptable: under 20 s for a short answer after loading.
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://localhost:8137/lune/"
ARGS = sys.argv[1:]
BACKEND = next((a for a in ARGS if a in ("webgpu", "wasm")), "webgpu")
USE_CHROME = "--chrome" in ARGS
HEADED = "--headed" in ARGS
APPLY = "--apply" in ARGS
CHROME = next(iter(sorted(Path("/opt/pw-browsers").glob("chromium-*/chrome-linux/chrome"))), None)
DEVICE_JS = Path(__file__).resolve().parents[1] / "frontend" / "ai-device.js"
SRC = DEVICE_JS.read_text(encoding="utf-8")
MODEL_ID = ARGS[ARGS.index("--model") + 1] if "--model" in ARGS else re.search(r'id: "([^"]+)"', SRC).group(1)


def apply(sizes: dict):
    """Write the tested model, its measured sizes and verified: true into ai-device.js."""
    src = DEVICE_JS.read_text(encoding="utf-8")
    name = MODEL_ID.split("/")[-1].replace("-", " ").replace("Qwen2.5 ", "Qwen2.5 ")
    src = re.sub(r"verified: (true|false),", "verified: true,", src, count=1)
    src = re.sub(r'id: "[^"]+",', f'id: "{MODEL_ID}",', src, count=1)
    src = re.sub(r'name: "[^"]+",', f'name: "{name}",', src, count=1)
    src = re.sub(r'webgpu: \{ dtype: "q4f16", bytes: \d+ \}', f'webgpu: {{ dtype: "q4f16", bytes: {sizes.get("q4f16", 0)} }}', src, count=1)
    src = re.sub(r'wasm: \{ dtype: "q4", bytes: \d+ \}', f'wasm: {{ dtype: "q4", bytes: {sizes.get("q4", 0)} }}', src, count=1)
    DEVICE_JS.write_text(src, encoding="utf-8")
    print(f"Wrote {MODEL_ID}, sizes and verified: true into {DEVICE_JS}")
NOTE = re.compile(r"\b([A-G])(?:[#♯b♭])?(\d)?\b")


def model_bytes(model_id: str) -> dict:
    """Bytes per build: the ONNX graph and weights for a dtype, plus tokenizer and config files."""
    url = f"https://huggingface.co/api/models/{model_id}/tree/main?recursive=1"
    files = json.loads(urllib.request.urlopen(url, timeout=60).read())
    size = {f["path"]: f.get("lfs", {}).get("size") or f.get("size", 0) for f in files if f.get("type") == "file"}
    common = sum(v for k, v in size.items() if k in ("config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json"))
    out = {}
    for dtype in ("q4f16", "q4", "int8", "fp16"):
        onnx = sum(v for k, v in size.items() if re.fullmatch(rf"onnx/model_{dtype}\.onnx(_data(_\d+)?)?", k))
        if onnx:
            out[dtype] = onnx + common
    return out


def notes_in(ctx_part) -> set:
    names = set()
    for n in ctx_part or []:
        m = re.match(r"([A-G])", str(n.get("note", "")))
        if m:
            names.add(m.group(1))
    return names


def main():
    print(f"model {MODEL_ID}")
    sizes = model_bytes(MODEL_ID)
    print("download bytes per build:", json.dumps(sizes))
    results = []
    with sync_playwright() as p:
        args = ["--headless=new"]
        if BACKEND == "webgpu":
            args += ["--enable-unsafe-webgpu", "--enable-features=Vulkan"]
        if HEADED:
            args = [a for a in args if a != "--headless=new"]
        if USE_CHROME:
            b = p.chromium.launch(channel="chrome", args=args, headless=not HEADED)
        else:
            b = p.chromium.launch(executable_path=str(CHROME) if CHROME else None, args=args, headless=not HEADED)
        ctx = b.new_context(ignore_https_errors=True)  # sandbox proxies re-sign HTTPS
        pg = ctx.new_page()
        pg.add_init_script(f"localStorage.setItem('lune.ai.device.test', '1'); localStorage.setItem('lune.ai.device.backend', '{BACKEND}');")
        if "--model" in ARGS:  # try a model other than the one in ai-device.js
            pg.add_init_script(f"addEventListener('DOMContentLoaded', () => {{ window.LuneDeviceAI.MODEL.id = '{MODEL_ID}'; }});")
        pg.goto(BASE + "#/beethoven-fur-elise/score", wait_until="networkidle")
        pg.wait_for_function("() => state.piece && Object.keys(state.piece.debriefs || {}).length > 0", timeout=90000)
        plan = pg.evaluate("() => LuneDeviceAI.plan()")
        print(f"backend {plan['device']} dtype {plan['dtype']} (WebGPU available: {plan['support']['webgpu']})")
        t0 = time.time()
        pg.evaluate("() => LuneDeviceAI.load()")
        load_s = time.time() - t0
        print(f"load (download + start): {load_s:.1f} s")

        def ask(question, bar):
            c = pg.evaluate("(bar) => LuneAsk.buildContext(bar)", bar)
            t = time.time()
            res = pg.evaluate(
                """async ([q, bar]) => {
                  const ctx = await LuneAsk.buildContext(bar);
                  let first = null; const t0 = performance.now();
                  const r = await LuneDeviceAI.chat([
                    {role: 'system', content: LuneAsk.SYSTEM_PROMPT},
                    {role: 'user', content: `CONTEXT:\\n${JSON.stringify(ctx)}\\n\\nQUESTION: ${q}`}],
                    {onToken: () => { if (first == null) first = performance.now() - t0; }});
                  return {text: r.text, tokens: r.tokens, ms: r.ms, first};
                }""",
                [question, bar],
            )
            res["wall"] = time.time() - t
            return c, res

        def record(name, ok, c, r, why=""):
            rate = r["tokens"] / (r["ms"] / 1000) if r["ms"] else 0
            results.append((name, ok, r["wall"], (r["first"] or 0) / 1000, rate, r["text"], why))

        bar = 5
        c, r = ask("What notes are in this bar?", bar)
        allowed = notes_in(c["bar"]["rightHand"]) | notes_in(c["bar"]["leftHand"])
        said = {m.group(1) for m in NOTE.finditer(r["text"]) if m.group(2) or len(r["text"]) < 400}
        record("notes come from the bar", said <= allowed and bool(said & allowed), c, r, f"said {sorted(said)}, bar has {sorted(allowed)}")

        c, r = ask("What is the fingering?", bar)
        fingers = {str(n.get("finger")) for n in c["bar"]["rightHand"] + c["bar"]["leftHand"] if n.get("finger") is not None}
        said = set(re.findall(r"\b([1-5])\b", r["text"]))
        record("fingers come from the bar", (said <= fingers) if fingers else bool(re.search(r"no fingering|not (given|have)|doesn.t have", r["text"], re.I)), c, r, f"said {sorted(said)}, bar has {sorted(fingers)}")

        c, r = ask("Which bars are hardest?", None)
        hard = {int(h["bar"]) for h in c["piece"]["hardestBars"]}
        said = {int(x) for x in re.findall(r"\bbars?\s+(\d+)", r["text"], re.I)} | {int(x) for x in re.findall(r"\b(?:and|,)\s*(\d+)\b", r["text"])}
        record("hard bars come from the context", bool(said) and said <= hard, c, r, f"said {sorted(said)}, context has {sorted(hard)}")

        c, r = ask("What is the opus number of this piece?", None)
        record("declines a fact it was not given", not re.search(r"\bop(us)?\.?\s*\d", r["text"], re.I) and bool(re.search(r"not|n't|no ", r["text"], re.I)), c, r)

        c, r = ask("Did that sound right when I played it just now?", bar)
        record("does not claim to have heard the pianist", not re.search(r"\b(you played (it )?(well|beautifully|nicely)|sounded (good|great|right)|I heard)\b", r["text"], re.I), c, r)
        b.close()

    print()
    for name, ok, wall, first, rate, text, why in results:
        print(f"{'PASS' if ok else 'FAIL'}  {name}  ({wall:.1f} s, first word {first:.1f} s, {rate:.1f} tokens/s) {why}")
        print("      " + text.replace("\n", " ")[:300])
    fast = all(w < 20 for _, _, w, *_ in results)
    good = all(ok for _, ok, *_ in results)
    print(f"\nload {load_s:.1f} s · grounded {sum(ok for _, ok, *_ in results)}/{len(results)} · every answer under 20 s: {fast}")
    print("VERDICT:", "good enough to turn on" if good and fast else "not good enough: leave MODEL.verified = false")
    if good and fast and APPLY:
        apply(sizes)
    elif APPLY:
        print("Nothing written to ai-device.js.")
    sys.exit(0 if good and fast else 1)


if __name__ == "__main__":
    main()
