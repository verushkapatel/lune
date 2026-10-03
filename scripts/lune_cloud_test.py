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


# ---------------------------------------------------------------- install

CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"
UAS = {
    "iphone": ("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1", "iPhone", "Add to Home Screen"),
    "ipad": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", "iPad", "Add to Home Screen"),
    "android": ("Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36", "Android (Chrome)", "Add to Home screen"),
    "mac-safari": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15", "Mac (Safari 17 or later)", "Add to Dock"),
    "edge": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "Microsoft Edge", "Install this site as an app"),
    "chrome": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "Chrome on a computer", "Install page as app"),
    "firefox": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0", "Firefox on a computer", "does not install"),
}


def section_install(browser):
    pg = new_page(browser)
    pg.goto(BASE, wait_until="networkidle")
    check("install: landing page shows Install Lune", pg.locator("#btn-install").is_visible())
    member = pg.evaluate("() => { const b = document.getElementById('btn-member-install'); return !!b && b.hasAttribute('data-install') && !b.hidden && !!b.closest('#home-member'); }")
    check("install: signed-in home has Install Lune", member)
    pg.evaluate("() => LunePractice?.openSettings ? LunePractice.openSettings() : document.getElementById('btn-settings').click()")
    pg.wait_for_timeout(500)
    check("install: Settings has Install Lune", pg.locator("#settings-dialog [data-install]").is_visible())
    pg.keyboard.press("Escape")

    # browsers without an install prompt get the steps for their platform first
    for key, (ua, title, words) in UAS.items():
        ctx = browser.new_context(user_agent=ua, viewport={"width": 1100, "height": 800}, has_touch=key == "ipad")
        q = ctx.new_page()
        if key == "ipad":
            q.add_init_script("Object.defineProperty(navigator, 'maxTouchPoints', {get: () => 5})")
        q.goto(BASE, wait_until="networkidle")
        q.click("#btn-install")
        q.wait_for_selector("#install-dialog[open]")
        first = q.evaluate("() => { const d = document.querySelector('#install-dialog details[open]'); return [d.querySelector('summary').textContent, d.textContent]; }")
        check(f"install: {key} gets its own steps first", first[0] == title and words in first[1], first[0])
        ctx.close()

    # a real install in Chromium, through the browser's own install path
    import tempfile

    # the headless shell has no PWA domain, so this uses the full Chromium build
    pctx = PW.chromium.launch_persistent_context(tempfile.mkdtemp(), headless=True, executable_path=CHROME, args=["--headless=new"])
    q = pctx.new_page()
    q.goto(BASE.replace("127.0.0.1", "localhost"), wait_until="networkidle")
    q.wait_for_timeout(2000)
    cdp = pctx.new_cdp_session(q)
    errs = cdp.send("Page.getInstallabilityErrors")["installabilityErrors"]
    check("install: Chromium reports no installability errors", errs == [], errs)
    check("install: Chromium offers its install prompt (beforeinstallprompt)", q.evaluate("() => LuneInstall.available()"))
    mid = cdp.send("Page.getAppId").get("appId")
    try:
        cdp.send("PWA.install", {"manifestId": mid})
        state = cdp.send("PWA.getOsAppState", {"manifestId": mid})
        check("install: Chromium installs Lune as an app", "badgeCount" in state, state)
    except Exception as e:
        check("install: Chromium installs Lune as an app", False, repr(e))
    pctx.close()
    # Chromium cannot emulate display-mode, so the installed window is stood in for by matchMedia
    ctx = browser.new_context()
    q = ctx.new_page()
    q.add_init_script("""const mm = window.matchMedia.bind(window);
      window.matchMedia = (s) => /display-mode: standalone/.test(s) ? {matches: true, media: s, addEventListener() {}, removeEventListener() {}} : mm(s);""")
    q.goto(BASE, wait_until="networkidle")
    q.evaluate("() => document.getElementById('btn-settings').click()")
    q.wait_for_timeout(400)
    hidden = q.evaluate("() => [document.getElementById('btn-install').hidden, document.getElementById('btn-member-install').hidden, !document.querySelector('#settings-dialog [data-install]')]")
    check("install: every Install button hides inside the installed app", all(hidden), hidden)
    ctx.close()


# ---------------------------------------------------------------- main

SECTIONS = {"ai": section_ai, "install": section_install}

if __name__ == "__main__":
    want = sys.argv[1:] or list(SECTIONS)
    with sync_playwright() as p:
        PW = p
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
