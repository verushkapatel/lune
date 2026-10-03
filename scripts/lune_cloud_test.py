#!/usr/bin/env python3
"""Browser checks for the work added after lune04 (Ask Lune models, install,
search tabs, ratings, This week, accessibility).

Serve a folder whose /lune/ is the synced Pages build on port 8137, start the
stand-in model server on 8139 (scripts/standin_model_server.py), then:

    python3 scripts/lune_cloud_test.py [section ...]

Sections: ai install tabs ratings week a11y. With none, all run.
"""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8137/lune/"
STANDIN = "http://127.0.0.1:8139/v1/chat/completions"
PIECE = BASE + "#/beethoven-fur-elise/score"
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:240]))


def new_page(browser, width=1280, height=860, storage=None):
    ctx = browser.new_context(viewport={"width": width, "height": height})
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    if storage:
        pg.goto(BASE, wait_until="domcontentloaded")
        pg.evaluate("(s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }", storage)
    return pg


def open_piece(pg, url=PIECE):
    pg.goto(url, wait_until="networkidle")
    pg.wait_for_function("() => typeof state !== 'undefined' && state.piece && Object.keys(state.piece.debriefs || {}).length > 0", timeout=60000)
    pg.wait_for_timeout(800)


def select_bar(pg, n):
    pg.evaluate("(n) => setBarSelection([n])", n)
    pg.wait_for_timeout(700)


# ---------------------------------------------------------------- ai


def section_ai(browser):
    # without a model: no model chips, an offer that states the size, nothing downloaded
    pg = new_page(browser)
    hf = []
    pg.on("request", lambda r: hf.append(r.url) if "huggingface" in r.url or "transformers" in r.url else None)
    open_piece(pg)
    select_bar(pg, 5)
    check("ai: no Lune AI row in the bar panel without a model", pg.locator(".lp-ai-row").count() == 0)
    pg.evaluate("() => LuneAsk.open({bar: 5})")
    pg.wait_for_timeout(600)
    chips = pg.eval_on_selector_all("#ask-chips button", "els => els.map(e => e.textContent)")
    check("ai: no model-only chips without a model", not pg.locator("#ask-chips [data-task]").count(), chips)
    offer = pg.locator("#ask-ai-offer")
    txt = offer.inner_text() if offer.is_visible() else ""
    check("ai: Ask Lune offers Lune AI with its download size", ("MB" in txt or "GB" in txt) and "Download" in txt, txt)
    check("ai: nothing is downloaded before the pianist turns it on", not hf, hf[:3])
    fine = pg.inner_text("#ask-fine")
    check("ai: built-in answers are not called a model", "not from a language model" in fine, fine)

    # with the stand-in endpoint: chips appear and each action reaches the model with context
    pg = new_page(browser, storage={"lune.ai.endpoint": STANDIN, "lune.ai.model": "standin"})
    open_piece(pg)
    select_bar(pg, 7)
    row = pg.eval_on_selector_all(".lp-ai-row button", "els => els.map(e => e.textContent)")
    check(
        "ai: bar panel has the Lune AI row when a model is connected",
        row == ["Explain this bar", "Why is this hard?", "Suggest practice", "Explain the fingering"],
        row,
    )
    pg.evaluate("() => LuneAsk.open({bar: 7})")
    pg.wait_for_timeout(500)
    tasks = pg.eval_on_selector_all("#ask-chips [data-task]", "els => els.map(e => e.dataset.task)")
    check("ai: Ask Lune shows the four bar actions as chips", tasks == ["explainBar", "whyHard", "suggestPractice", "explainFingering"], tasks)
    ok_all = True
    for task in tasks:
        pg.click(f'#ask-chips [data-task="{task}"]')
        pg.wait_for_function("() => document.querySelector('#ask-log .ask-msg[data-via=model]:last-of-type')", timeout=15000)
        last = pg.evaluate("() => [...document.querySelectorAll('#ask-log .ask-msg')].pop().textContent")
        sent = json.loads(urllib.request.urlopen(STANDIN.replace("/v1/chat/completions", "/")).read())
        user = sent["messages"][-1]["content"]
        ok = last == "STANDIN reply about bar 7." and '"number":7' in user and sent["messages"][0]["role"] == "system"
        ok_all &= ok
        if not ok:
            check(f"ai: {task} reaches the model with bar 7", False, (last, user[:120]))
        pg.evaluate("() => LuneAsk.open({bar: 7})")
    check("ai: every bar action reaches the model with that bar's context", ok_all)
    pg.evaluate("() => { setBarSelection([]); }")
    pg.wait_for_timeout(400)
    pg.evaluate("() => LuneAsk.open()")
    pg.wait_for_timeout(400)
    tasks = pg.eval_on_selector_all("#ask-chips [data-task]", "els => els.map(e => e.dataset.task)")
    check("ai: with no bar selected, Summarise my practice is offered", tasks == ["summarizePractice"], tasks)
    pg.click('#ask-chips [data-task="summarizePractice"]')
    pg.wait_for_timeout(1500)
    last = pg.evaluate("() => [...document.querySelectorAll('#ask-log .ask-msg')].pop().textContent")
    check("ai: Summarise my practice answers from the model", last == "STANDIN reply about the piece.", last)
    check("ai: no page errors", not pg.errors, pg.errors[:3])

    # the model is down: the built-in reply is shown and labelled
    pg = new_page(browser, storage={"lune.ai.endpoint": "http://127.0.0.1:9/none", "lune.ai.model": "x"})
    open_piece(pg)
    select_bar(pg, 7)
    pg.evaluate("() => LuneAsk.runTask('explainFingering', 7)")
    pg.wait_for_timeout(2500)
    msgs = pg.eval_on_selector_all("#ask-log .ask-msg", "els => els.map(e => e.textContent)")
    check("ai: a failed model falls back to the built-in reply, labelled", any("built-in reply" in m for m in msgs), msgs[-2:])


# ---------------------------------------------------------------- main

SECTIONS = {"ai": section_ai}

if __name__ == "__main__":
    want = sys.argv[1:] or list(SECTIONS)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for name in want:
            try:
                SECTIONS[name](browser)
            except Exception as e:  # a crashed section is a failure, not a stop
                check(f"{name}: section ran", False, repr(e))
        browser.close()
    for status, name, detail in out:
        print(f"{status}  {name}" + (f"  ({detail})" if status == "FAIL" and detail else ""))
    passed = sum(1 for s, _, _ in out if s == "PASS")
    print(f"\n{passed}/{len(out)} passed")
    sys.exit(0 if passed == len(out) else 1)
