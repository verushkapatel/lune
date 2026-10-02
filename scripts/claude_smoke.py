"""End-to-end smoke test: every main flow, collecting page errors.

python3 scripts/claude_smoke.py  (server on 127.0.0.1:8000)
"""
import sys
import time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/?v=smoke"
results = []


def step(name, fn):
    t = time.time()
    try:
        out = fn()
        results.append(("ok", name, round(time.time() - t, 2), out))
    except Exception as e:  # noqa: BLE001
        results.append(("FAIL", name, round(time.time() - t, 2), str(e).splitlines()[0][:160]))


def run(width):
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
        pg = b.new_page(viewport={"width": width, "height": 860})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
        pg.on("console", lambda m: errs.append("console: " + m.text[:200]) if m.type == "error" and "ERR_TUNNEL" not in m.text and "Failed to load resource" not in m.text else None)

        step(f"[{width}] home loads", lambda: pg.goto(BASE, wait_until="networkidle"))
        step(f"[{width}] empty search does nothing harmful", lambda: (pg.fill("#q", ""), pg.press("#q", "Enter"), pg.wait_for_timeout(600), pg.evaluate("() => document.getElementById('home') && !document.getElementById('home').hidden"))[-1])
        step(f"[{width}] whitespace search", lambda: (pg.fill("#q", "   "), pg.press("#q", "Enter"), pg.wait_for_timeout(600), "ok")[-1])

        def open_elise():
            pg.fill("#q", "fur elise"); pg.press("#q", "Enter")
            pg.wait_for_function("() => !document.getElementById('studio')?.hidden", timeout=30000)
            return pg.evaluate("() => document.getElementById('btn-open-piece')?.textContent")
        step(f"[{width}] search opens overview", open_elise)

        def to_score():
            pg.click("#tab-score")
            pg.wait_for_function("() => document.querySelectorAll('text.lune-letter').length > 100", timeout=60000)
            return pg.evaluate("() => document.querySelectorAll('text.lune-letter').length")
        step(f"[{width}] score tab shows letters", to_score)

        def rapid_toggle():
            for m in ["fingers", "off", "notes", "fingers", "notes", "off", "fingers"]:
                pg.evaluate("(m)=>{const el=document.getElementById('anno-'+m); el.checked=true; el.dispatchEvent(new Event('change',{bubbles:true}))}", m)
                pg.wait_for_timeout(60)
            pg.wait_for_timeout(1200)
            r = pg.evaluate("() => ({l: document.querySelectorAll('text.lune-letter').length, f: document.querySelectorAll('text.lune-finger').length})")
            assert r["l"] == 0 and r["f"] > 0, r
            return r
        step(f"[{width}] rapid mode toggling ends consistent", rapid_toggle)

        def play_stop():
            pg.click("#btn-play") if pg.locator("#btn-play").count() else pg.keyboard.press("Space")
            pg.wait_for_timeout(1500)
            pg.keyboard.press("Space")
            pg.wait_for_timeout(300)
            return "ok"
        step(f"[{width}] play / pause", play_stop)

        def click_bar():
            box = pg.locator("#osmd svg").bounding_box()
            pg.mouse.click(box["x"] + box["width"] * 0.5, box["y"] + 160)
            pg.wait_for_timeout(800)
            pg.keyboard.press("Escape")
            return "ok"
        step(f"[{width}] click a bar, Esc closes", click_bar)
        step(f"[{width}] arrow keys", lambda: (pg.keyboard.press("ArrowRight"), pg.keyboard.press("ArrowLeft"), "ok")[-1])
        step(f"[{width}] piano tab", lambda: (pg.click("#tab-piano"), pg.wait_for_timeout(700), "ok")[-1])
        step(f"[{width}] explain tab", lambda: (pg.click("#tab-explain"), pg.wait_for_timeout(500), "ok")[-1])

        def resize_back():
            pg.click("#tab-score"); pg.wait_for_timeout(500)
            pg.set_viewport_size({"width": 700 if width > 700 else 1100, "height": 860}); pg.wait_for_timeout(1500)
            pg.set_viewport_size({"width": width, "height": 860}); pg.wait_for_timeout(1500)
            return pg.evaluate("() => document.querySelectorAll('text.lune-finger').length")
        step(f"[{width}] resize keeps overlays", resize_back)

        def nonsense():
            pg.goto(BASE, wait_until="networkidle")
            pg.fill("#q", "qqqzzz"); pg.press("#q", "Enter"); pg.wait_for_timeout(2500)
            return pg.evaluate("() => document.getElementById('toast')?.textContent")
        step(f"[{width}] nonsense search message", nonsense)

        step(f"[{width}] page errors", lambda: errs if not errs else (_ for _ in ()).throw(Exception("; ".join(errs[:4]))))
        b.close()


for w in [int(x) for x in (sys.argv[1:] or ["390", "1280"])]:
    run(w)
for r in results:
    print(*r)
