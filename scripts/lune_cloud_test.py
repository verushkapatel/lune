#!/usr/bin/env python3
"""Browser checks for the work added after lune04 (Ask Lune models, install,
search tabs, ratings, This week, accessibility).

Serve a folder whose /lune/ is the synced Pages build on port 8137, start the
stand-in model server on 8139 (scripts/standin_model_server.py), then:

    python3 scripts/lune_cloud_test.py [section ...]

Sections: ai install tabs a11y ratings week catalogue console account latest. With none, all run.
"""
import json
import os
import sys
import urllib.request

from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))

BASE = "http://127.0.0.1:8137/lune/"
STANDIN = "http://127.0.0.1:8139/v1/chat/completions"
PIECE = BASE + "#/beethoven-fur-elise/score"
out = []


def check(name, ok, detail=""):
    if os.environ.get("LUNE_TRACE"): print("..", "PASS" if ok else "FAIL", name, flush=True)
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
    # with Lune AI's server not set (as before launch): no model chips, nothing downloaded
    off = browser.new_context(viewport={"width": 1280, "height": 860})
    off.add_init_script(POINT_AT_SERVER.replace(ACCOUNT_SERVER, ""))
    pg = off.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    hf = []
    pg.on("request", lambda r: hf.append(r.url) if "huggingface" in r.url or "transformers" in r.url else None)
    open_piece(pg)
    select_bar(pg, 5)
    check("ai: no Lune AI row in the bar panel without a model", pg.locator(".lp-ai-row").count() == 0)
    pg.evaluate("() => LuneAsk.open({bar: 5})")
    pg.wait_for_timeout(600)
    chips = pg.eval_on_selector_all("#ask-chips button", "els => els.map(e => e.textContent)")
    check("ai: no model-only chips without a model", not pg.locator("#ask-chips [data-task]").count(), chips)
    check("ai: Lune AI on this device is not offered before a real model has passed its test", not pg.locator("#ask-ai-offer").is_visible())
    pg.evaluate("() => document.getElementById('btn-settings').click()")
    pg.wait_for_timeout(500)
    # Ollama sits under Advanced details since Settings became one page with fewer options
    check("ai: Settings does not offer it either, and still offers Ollama under Advanced details",
          pg.locator("#set-device-ai").count() == 0 and pg.locator("details [data-ai=ollama]").count() == 1)
    pg.keyboard.press("Escape")
    # the developer switch shows the offer: it states the size and source before anything downloads
    pg.evaluate("() => { localStorage.setItem('lune.ai.device.test', '1'); LuneAsk.close(); LuneAsk.open({bar: 5}); }")
    pg.wait_for_timeout(600)
    offer = pg.locator("#ask-ai-offer")
    txt = offer.inner_text() if offer.is_visible() else ""
    check("ai: when offered, it states the download and where it comes from", ("MB" in txt or "GB" in txt) and "Download" in txt, txt)
    pg.evaluate("() => localStorage.removeItem('lune.ai.device.test')")
    check("ai: nothing is downloaded before the pianist turns it on", not hf, hf[:3])
    pg.goto(BASE, wait_until="networkidle")
    check("ai: no “superpowered with Lune AI” line until Lune AI's server is set",
          pg.evaluate("() => [...document.querySelectorAll('[data-ai-news]')].every(b => b.hidden)"))
    open_piece(pg)
    select_bar(pg, 5)
    pg.evaluate("() => LuneAsk.open({bar: 5})")
    pg.wait_for_timeout(400)
    fine = pg.inner_text("#ask-fine")
    check("ai: built-in answers are not called a model", "not from a language model" in fine, fine)

    # with the stand-in endpoint: chips appear and each action reaches the model with context
    pg = new_page(browser, storage={"lune.ai.endpoint": STANDIN, "lune.ai.model": "standin"})
    open_piece(pg)
    select_bar(pg, 7)
    row = pg.eval_on_selector_all(".lp-ai-row button", "els => els.map(e => e.textContent)")
    check(
        "ai: bar panel has the Lune AI row when a model is connected",
        row == ["Explain", "Why it’s hard", "How to practise", "Fingering"],
        row,
    )
    pg.evaluate("() => LuneAsk.open({bar: 7})")
    pg.wait_for_timeout(500)
    tasks = pg.eval_on_selector_all("#ask-chips [data-task]", "els => els.map(e => e.dataset.task)")
    check("ai: Ask Lune shows the four bar actions as chips", tasks == ["explainBar", "whyHard", "suggestPractice", "explainFingering"], tasks)
    ok_all = True
    for task in tasks:
        # chips show on an empty chat only; after the first answer the same actions run from the bar panel
        n = pg.evaluate("() => document.querySelectorAll('#ask-log .ask-msg[data-via=model]').length")
        pg.evaluate(f"() => {{ LuneAsk.runTask('{task}', 7); }}")
        # data-via is set once the answer has finished arriving
        pg.wait_for_function(f"() => document.querySelectorAll('#ask-log .ask-msg[data-via=model]').length > {n}", timeout=15000)
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


# ---------------------------------------------------------------- tabs


def section_tabs(browser):
    pg = new_page(browser)
    scores = []
    pg.on("request", lambda r: scores.append(r.url) if "/static/scores/" in r.url else None)
    pg.goto(BASE + "#/beethoven-fur-elise/explain", wait_until="networkidle")
    pg.wait_for_function("() => /Elise/.test(state.piece?.overview?.title || '')", timeout=60000)
    pg.goto(BASE + "#/debussy-clair-de-lune/explain", wait_until="networkidle")
    pg.wait_for_function("() => state.sessions.length === 2 && /Clair/.test(state.piece?.overview?.title || '')", timeout=60000)
    pg.wait_for_timeout(500)
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('lune.tabs'))")
    ids = pg.evaluate("() => state.sessions.map(s => pieceRouteId(s.piece))")
    check("tabs: open tabs are stored as ids", [t["id"] for t in saved["tabs"]] == ids and "fur-elise" in ids[0], saved)
    check("tabs: the current tab is stored", saved["active"] == ids[1], saved.get("active"))

    # reload on the home page: both tabs come back, no score is fetched
    scores.clear()
    pg.goto(BASE, wait_until="networkidle")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(800)
    labels = pg.eval_on_selector_all("#piece-tabs .piece-tab-label", "els => els.map(e => e.textContent)")
    check("tabs: both tabs are back after a reload", len(labels) == 2 and "Für Elise" in labels[0], labels)
    check("tabs: no score is downloaded until a tab is opened", not scores, scores[:2])
    check("tabs: the + button is still there", pg.locator("#piece-tabs .piece-tab-new").is_visible())

    # opening a restored tab loads its score and marks it as current
    pg.click("#piece-tabs .piece-tab-label >> nth=1")
    pg.wait_for_function("() => /Clair/.test(state.piece?.overview?.title || '') && document.body.classList.contains('is-studio')", timeout=60000)
    pg.wait_for_timeout(600)
    check("tabs: opening a restored tab fetches only its score", len(scores) == 1 and "clair" in scores[0].lower(), scores)
    cur = pg.evaluate("() => [...document.querySelectorAll('#piece-tabs .piece-tab-label')].map(b => [b.textContent, b.getAttribute('aria-current'), b.closest('.piece-tab').classList.contains('on')])")
    check("tabs: the current tab is marked (aria-current and the underline)", cur[1][1:] == ["page", True] and cur[0][1:] == [None, False], cur)

    # a reload on a piece's own link reopens that piece with the other tab kept
    pg.goto(BASE + "#/beethoven-fur-elise/explain")
    pg.reload(wait_until="networkidle")
    pg.wait_for_function("() => /Elise/.test(state.piece?.overview?.title || '')", timeout=60000)
    n = pg.evaluate("() => [state.sessions.length, state.sessions.filter(s => s.lazy).length]")
    check("tabs: a piece link reload opens that tab and keeps the other one waiting", n == [2, 1], n)

    # closing a tab forgets it
    pg.click("#piece-tabs .piece-tab-close >> nth=1")
    pg.wait_for_timeout(400)
    saved = pg.evaluate("() => JSON.parse(localStorage.getItem('lune.tabs'))")
    check("tabs: a closed tab is not restored", [t["id"] for t in saved["tabs"]] == ids[:1], saved)
    check("tabs: no page errors", not pg.errors, pg.errors[:3])


# ---------------------------------------------------------------- a11y


def section_a11y(browser):
    pg = new_page(browser)
    open_piece(pg)
    # the score is reachable by keyboard and the arrow keys pick bars from nothing selected
    pg.focus("#score-scroll")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(500)
    sel = pg.evaluate("() => selectedBarsSorted()")
    check("a11y: with the score focused, an arrow key selects the first bar", sel[:1] == [1], sel)
    live = pg.inner_text("#score-live")
    check("a11y: the selected bar is announced", live.startswith("Bar "), live)
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(300)
    two = pg.evaluate("() => selectedBarsSorted()")
    check("a11y: ArrowRight moves to the next bar", two and sel and two[0] == sel[0] + 1, two)
    pg.keyboard.press("End")
    pg.wait_for_timeout(300)
    last = pg.evaluate("() => [selectedBarsSorted()[0], Math.max(...Object.keys(state.piece.debriefs).map(Number))]")
    sel = sel or [1]
    check("a11y: End goes to the last bar", last[0] == last[1], last)
    pg.keyboard.press("Home")
    pg.wait_for_timeout(300)
    check("a11y: Home goes to the first bar", pg.evaluate("() => selectedBarsSorted()[0]") == sel[0])
    check("a11y: the bar panel opened", pg.evaluate("() => state.coachOpen"))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    check("a11y: Escape closes the bar panel and focus is back on the score", pg.evaluate("() => !state.coachOpen && document.activeElement.id === 'score-scroll'"))
    check("a11y: Score tab has an h1", pg.evaluate("() => { const h = [...document.querySelectorAll('h1')].filter(h => !h.closest('[hidden]') && !h.hidden); return h.length === 1 && /score/.test(h[0].textContent); }"))

    # Ask Lune: focus goes in, answers go to a polite log, Escape returns focus to the opener
    pg.focus("#btn-tell")
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(500)
    check("a11y: opening Ask Lune puts focus in its text box", pg.evaluate("() => document.activeElement.id === 'ask-input'"))
    log = pg.evaluate("() => [document.getElementById('ask-log').getAttribute('role'), document.getElementById('ask-log').getAttribute('aria-live')]")
    check("a11y: Ask Lune answers are in a polite live log", log == ["log", "polite"], log)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    check("a11y: closing Ask Lune returns focus to the button that opened it", pg.evaluate("() => document.activeElement.id === 'btn-tell'"))

    # dialogs: focus moves in, Escape closes, focus comes back
    pg.goto(BASE, wait_until="networkidle")
    for opener, dialog in (("#btn-settings", "#settings-dialog"), ("#btn-install", "#install-dialog"), ("#footer-feedback", "dialog[open]")):
        pg.focus(opener)
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(500)
        inside = pg.evaluate(f"() => !!document.querySelector('{dialog}[open], dialog[open]')?.contains(document.activeElement)")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        back = pg.evaluate(f"() => document.activeElement === document.querySelector('{opener}') && !document.querySelector('dialog[open]')")
        check(f"a11y: {opener} dialog takes focus and gives it back on Escape", inside and back, (inside, back))
    lm = pg.evaluate("() => ({banner: document.querySelectorAll('body > header, header.bar').length, main: [...document.querySelectorAll('main')].filter(m => !m.hidden).length})")
    check("a11y: one banner and one visible main landmark", lm["banner"] >= 1 and lm["main"] == 1, lm)
    check("a11y: no page errors", not pg.errors, pg.errors[:3])


# ---------------------------------------------------------------- ratings


def section_ratings(browser):
    # a browser that rated bars before the rename, with the old "easy"
    old = {
        "v": 1, "repertoire": [], "notes": [], "tasks": [], "stumbles": [],
        "cards": [{"piece_key": "k", "bar": 3, "ease": 2.65, "interval_days": 4.2, "reps": 3, "lapses": 0,
                   "due_at": "2030-01-01T00:00:00.000Z", "last_grade": "easy", "updated_at": "2026-09-01T00:00:00.000Z"}],
        "activity": [],
    }
    pg = new_page(browser, storage={"lune.local.v1": json.dumps(old)})
    pg.goto(BASE, wait_until="networkidle")
    week = pg.evaluate("() => LuneStore.weekSnapshot().week")
    pg.evaluate("""(week) => { const d = JSON.parse(localStorage.getItem('lune.local.v1'));
      d.activity.push({id: 'a1', kind: 'review', piece_key: 'k', bar: 3, grade: 'easy', mins: 0, day: new Date().toISOString().slice(0, 10), week, created_at: new Date().toISOString()});
      localStorage.setItem('lune.local.v1', JSON.stringify(d)); }""", week)
    pg.reload(wait_until="networkidle")
    cards = pg.evaluate("() => LuneStore.listCards('k')")
    check("ratings: a stored Easy rating is migrated to Strong", cards and cards[0]["last_grade"] == "strong", cards)
    raw = pg.evaluate("() => localStorage.getItem('lune.local.v1')")
    check("ratings: nothing in storage still says easy", '"easy"' not in raw)
    snap = pg.evaluate("() => LuneStore.weekSnapshot()")
    check("ratings: a migrated Strong counts with Good in This week", snap["good"] == 1 and snap["hard"] == 0, snap)

    # the five ratings keep the spaced-repetition order: a stronger rating never comes back sooner
    order = pg.evaluate("""() => {
      const out = {};
      for (const card of [{}, {reps: 2, interval_days: 3, ease: 2.5}, {reps: 5, interval_days: 20, ease: 2.2}]) {
        const key = 'reps' + (card.reps || 0);
        out[key] = LuneStore.GRADES.map(g => [g, new Date(LuneStore.schedule(card, g).due_at).getTime()]);
      }
      return out;
    }""")
    mono = all(all(a[1] <= b[1] for a, b in zip(v, v[1:])) for v in order.values())
    strict = all(a[1] < b[1] for a, b in zip(order["reps2"], order["reps2"][1:]))
    check("ratings: Again < Hard ≤ Okay ≤ Good ≤ Strong for new and seasoned bars", mono, order)
    check("ratings: on a bar with history each rating gives a different, later review", strict, order["reps2"])
    eased = pg.evaluate("() => [LuneStore.schedule({reps: 2, interval_days: 3, ease: 2.5}, 'easy').due_at === LuneStore.schedule({reps: 2, interval_days: 3, ease: 2.5}, 'strong').due_at, LuneStore.schedule({}, 'again').lapses]")
    check("ratings: the old name schedules exactly like Strong, and Again is a lapse", eased == [True, 1], eased)

    # the bar panel offers the five, and a press is saved with its name
    open_piece(pg)
    select_bar(pg, 4)
    labels = pg.eval_on_selector_all(".lp-grades .lp-grade", "els => els.map(e => e.textContent)")
    check("ratings: the bar panel offers Again, Hard, Okay, Good, Strong", labels == ["Again", "Hard", "Okay", "Good", "Strong"], labels)
    pg.click(".lp-grades .lp-okay")
    pg.wait_for_timeout(600)
    card = pg.evaluate("async () => (await LuneStore.listCards(LunePractice.keyFor(state.piece))).find(c => c.bar === 4)")
    check("ratings: pressing Okay saves an okay rating with a review date", card and card["last_grade"] == "okay" and card["due_at"] > "2026", card)
    fits = pg.evaluate("() => [...document.querySelectorAll('.lp-grades .lp-grade')].every(b => b.scrollWidth <= b.clientWidth + 1)")
    check("ratings: the five labels fit their buttons", fits)

    # Ask Lune understands the new words
    select_bar(pg, 6)
    pg.evaluate("() => LuneAsk.ask('bar 6 went okay')")
    pg.wait_for_timeout(800)
    card = pg.evaluate("async () => (await LuneStore.listCards(LunePractice.keyFor(state.piece))).find(c => c.bar === 6)")
    check("ratings: “bar 6 went okay” in Ask Lune logs Okay", card and card["last_grade"] == "okay", card)
    pg.evaluate("() => LuneAsk.ask('bar 6 felt strong')")
    pg.wait_for_timeout(800)
    card = pg.evaluate("async () => (await LuneStore.listCards(LunePractice.keyFor(state.piece))).find(c => c.bar === 6)")
    check("ratings: “bar 6 felt strong” logs Strong", card and card["last_grade"] == "strong", card)

    # at 390 px the five fit too
    q = new_page(browser, width=390, height=844)
    open_piece(q)
    select_bar(q, 4)
    fits = q.evaluate("() => [...document.querySelectorAll('.lp-grades .lp-grade')].every(b => b.scrollWidth <= b.clientWidth + 1 && b.getBoundingClientRect().width >= 44)")
    check("ratings: at 390 px each rating button is at least 44 px wide and its label fits", fits)
    check("ratings: no page errors", not pg.errors and not q.errors, (pg.errors + q.errors)[:3])


# ---------------------------------------------------------------- week


SEED_WEEK = """(nowIso) => {
  const now = new Date(nowIso);
  const ago = (days) => new Date(now.getTime() - days * 864e5).toISOString();
  const ahead = (days) => new Date(now.getTime() + days * 864e5).toISOString();
  const week = LuneStore.weekSnapshot().week;
  const today = now.toISOString().slice(0, 10);
  const d = JSON.parse(localStorage.getItem('lune.local.v1') || '{"v":1}');
  d.v = 1;
  d.repertoire = [{piece_key: 'fe', title: 'Für Elise', composer: 'Beethoven', status: 'learning', created_at: ago(30)},
                  {piece_key: 'cl', title: 'Clair de lune', composer: 'Debussy', status: 'learning', created_at: ago(30)}];
  d.notes = []; d.stumbles = [];
  d.tasks = [
    {id: 't1', piece_key: 'fe', title: 'Für Elise', bars: [3, 4, 5], notes: 'private words', done: false, created_at: ago(0), plan: {source: 'ask', summary: '20 minutes on bars 3, 4, 5.'}},
    {id: 't2', piece_key: 'cl', title: 'Clair de lune', bars: [12], notes: '', done: true, done_at: ago(0), created_at: ago(0), plan: {source: 'self'}},
    {id: 't3', piece_key: 'fe', title: 'Für Elise', bars: [20], notes: '', done: false, created_at: ago(15), plan: {source: 'repertoire'}},
    {id: 't4', piece_key: 'cl', title: 'Clair de lune', bars: [1], notes: '', done: true, done_at: ago(20), created_at: ago(25), plan: {source: 'self'}},
  ];
  d.cards = [
    {piece_key: 'fe', bar: 7, ease: 2.3, interval_days: 0, reps: 0, lapses: 1, due_at: ago(0.01), last_grade: 'hard', updated_at: ago(0.02)},
    {piece_key: 'cl', bar: 9, ease: 2.5, interval_days: 8, reps: 3, lapses: 0, due_at: ahead(8), last_grade: 'good', updated_at: ago(0)},
    {piece_key: 'cl', bar: 30, ease: 2.5, interval_days: 30, reps: 5, lapses: 0, due_at: ahead(30), last_grade: 'strong', updated_at: ago(40)},
  ];
  d.activity = [
    {id: 'a1', kind: 'review', piece_key: 'fe', bar: 7, grade: 'hard', mins: 0, day: today, week, created_at: ago(0)},
    {id: 'a2', kind: 'review', piece_key: 'fe', bar: 7, grade: 'again', mins: 0, day: today, week, created_at: ago(0)},
    {id: 'a3', kind: 'review', piece_key: 'cl', bar: 9, grade: 'good', mins: 0, day: today, week, created_at: ago(0)},
  ];
  localStorage.setItem('lune.local.v1', JSON.stringify(d));
}"""


def section_week(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin=BASE.rstrip("/").rsplit("/", 1)[0])
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    pg.goto(BASE, wait_until="networkidle")
    now = pg.evaluate("() => new Date().toISOString()")
    pg.evaluate(SEED_WEEK, now)
    pg.reload(wait_until="networkidle")
    plan = pg.evaluate("async () => LuneImpact.weekPlan(LuneStore.weekSnapshot().week)")
    items = {(x["title"], tuple(x["bars"]), x["kind"]): x for x in plan["items"]}
    check("week: holds this week's tasks, an open task carried over, and due reviews",
          ("Für Elise", (3, 4, 5), "task") in items and ("Für Elise", (20,), "task") in items and ("Für Elise", (7,), "review") in items, list(items))
    check("week: a task finished in an earlier week is not listed", ("Clair de lune", (1,), "task") not in items)
    check("week: a bar not due this week and not rated this week is not listed", ("Clair de lune", (30,), "review") not in items)
    check("week: done and left are counted", plan["done"] == 2 and plan["left"] == 3, (plan["done"], plan["left"]))
    why = {k: v["why"] for k, v in items.items()}
    check("week: an Ask Lune plan says where it came from", why[("Für Elise", (3, 4, 5), "task")].startswith("You asked Lune for a plan"), why)
    check("week: a carried-over task says so", "Carried over" in why[("Für Elise", (20,), "task")], why)
    check("week: a due review says how it was rated", "rated it Hard" in why[("Für Elise", (7,), "review")] and "due again" in why[("Für Elise", (7,), "review")], why)

    pg.evaluate("() => LuneImpact.openWeeklyReview()")
    pg.wait_for_selector("#weekly-review-dialog[open] .week-items")
    progress = pg.inner_text("#week-progress")
    check("week: the review shows how much is done", progress == "2 of 5 done · 3 left", progress)
    first = pg.evaluate("() => [...document.querySelectorAll('#weekly-review-dialog .week-item')].map(li => [li.querySelector('.week-status').textContent, li.querySelector('.week-why')?.textContent || ''])")
    check("week: what is left comes first, and every item says why it is there", first[0][0] == "To do" and first[-1][0] == "Done" and all(w for _, w in first), first)
    hard = pg.inner_text("#weekly-review-dialog .impact-list")
    check("week: bars rated Again or Hard this week are listed", "bar 7" in hard and "2 times" in hard, hard)
    check("week: private task notes are not shown", "private words" not in pg.inner_text("#weekly-review-dialog"))

    # Share this week: a summary someone can read without opening Lune
    pg.click("#weekly-review-dialog [data-impact-share]")
    pg.wait_for_selector("#share-week-dialog[open]")
    pg.fill("#share-display-name", "Test pianist")
    pg.check("#share-include-bars")
    pg.click("[data-share-copy]")
    pg.wait_for_timeout(600)
    text = pg.evaluate("() => navigator.clipboard.readText()")
    lines = text.split("\n")
    check("share: the summary opens with who and which week", lines[0].startswith("Test pianist: practice week "), lines[0])
    check("share: the summary says days, sessions and progress in sentences",
          lines[1].startswith("Practised on 1 of the ") and "2 of 5 planned things done." in text, lines[:3])
    check("share: done and still-to-do are listed by piece and bars",
          "Done: Clair de lune, bar 12" in text and "Still to do: Für Elise, bars 3–5" in text, text)
    check("share: hard bars are included when asked", "Hard bars: Für Elise, bar 7" in text, text)
    check("share: no private note text is in the summary", "private words" not in text)

    # the page a teacher opens shows the same plan, done or not
    payload = pg.evaluate("""async () => { const s = LuneStore.weekSnapshot(); const p = await LuneImpact.weekPlan(s.week);
      return {displayName: 'Test pianist', week: s.week, weekLabel: 'this week', days: s.days, goalDays: s.goalDays, sessions: s.sessions,
              items: p.items.map(x => ({title: x.title, bars: x.bars, done: x.done, kind: x.kind})), pieces: [], hardBars: []}; }""")
    pg.goto(BASE + "#share/test", wait_until="networkidle")
    pg.evaluate("async (p) => { LuneStore.fetchShareByToken = async () => ({payload: p}); await LuneImpact.handleRoute(); }", payload)
    pg.wait_for_timeout(500)
    page = pg.inner_text("#share-page")
    check("share page: shows the week's plan with done and to do", "This week’s plan: 2 of 5 done" in page and "To do" in page, page[:300])
    check("week: no page errors", not pg.errors, pg.errors[:3])
    ctx.close()


# ---------------------------------------------------------------- catalogue


def section_catalogue(browser):
    # this sandbox's proxy re-signs HTTPS, so remote scores need its certificate accepted here
    ctx = browser.new_context(viewport={"width": 1280, "height": 860}, ignore_https_errors=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    pg.goto(BASE, wait_until="networkidle")
    cat = pg.evaluate("() => fetch('static/remote-catalog.json').then(r => r.json())")
    k576 = [x for x in cat["items"] if x["source"] == "dcml-mozart"]
    check("catalogue: K. 576 has its three movements", [x["title"] for x in k576] == [
        "Piano Sonata no. 18 in D major, K. 576 — Allegro",
        "Piano Sonata no. 18 in D major, K. 576 — Adagio",
        "Piano Sonata no. 18 in D major, K. 576 — Allegretto"], [x["title"] for x in k576])
    ok = all(x["url"].startswith("https://raw.githubusercontent.com/") and x["credit"]["license"] == "CC BY-NC-SA 4.0" and x["credit"]["licenseUrl"] for x in k576)
    check("catalogue: each comes from the allowlisted host with its licence", ok)
    idx = pg.evaluate("() => fetch('static/search-index.json').then(r => r.json())")
    eighteen = [x["title"] for x in idx["items"] if "Sonata no. 18" in x["title"] and "Mozart" in x.get("composer", "")]
    check("catalogue: sonata no. 18 is listed once per movement", len(eighteen) == 3, eighteen)
    check("catalogue: the index counts match its items", idx["count"] == len(idx["items"]) and cat["count"] == len(cat["items"]))
    hits = pg.evaluate("() => filterSearchIndex('mozart sonata 18', 8).map(h => h.title)")
    check("catalogue: searching “mozart sonata 18” finds it", any("K. 576" in h for h in hits), hits)
    pg.goto(BASE + "#/dcml-mozart-k576-2/score", wait_until="networkidle")
    pg.wait_for_function("() => state.piece && Object.keys(state.piece.debriefs || {}).length > 0", timeout=90000)
    info = pg.evaluate("() => [state.piece.title || state.piece.overview?.title, Object.keys(state.piece.debriefs).length, state.piece.credit?.license, document.querySelectorAll('#osmd svg').length]")
    check("catalogue: the Adagio opens, is analysed bar by bar and renders", info[0].endswith("Adagio") and info[1] > 50 and info[3] > 0, info)
    check("catalogue: the opened piece carries its licence", info[2] == "CC BY-NC-SA 4.0", info)
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("() => document.querySelector('[data-open-credits]').click()")
    pg.wait_for_timeout(400)
    credits = pg.inner_text("dialog[open]")
    check("catalogue: the credits name the edition, its licence and When in Rome", "Annotated Mozart Sonatas" in credits and "When in Rome" in credits)
    check("catalogue: no page errors", not pg.errors, pg.errors[:3])
    ctx.close()


# ---------------------------------------------------------------- console


def section_console(browser):
    """Every screen: no page errors, no console errors, no failed requests to Lune itself.

    Requests to other hosts are listed but not failed: this environment's network
    policy blocks some of them (Supabase, fonts, model hosts) that work for visitors.
    """
    from lune_screens import READY, SCREENS

    bad, outside = [], set()
    for name, (url, js, wait) in SCREENS.items():
        ctx = browser.new_context(viewport={"width": 1280, "height": 860})
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(f"pageerror {str(e)[:120]}"))
        pg.on("console", lambda m: errs.append(f"console {m.text[:120]}") if m.type == "error" else None)
        pg.on("requestfailed", lambda r: (errs.append(f"failed {r.url[:100]}") if r.url.startswith(BASE.split("/lune/")[0]) else outside.add(r.url.split("/")[2])))
        pg.on("response", lambda r: errs.append(f"{r.status} {r.url[:100]}") if r.status >= 400 and r.url.startswith(BASE.split("/lune/")[0]) else None)
        pg.goto(url, wait_until="networkidle")
        if "score" in url or "piano" in url:
            pg.wait_for_function(READY, timeout=60000)
        if js:
            pg.evaluate(js)
        pg.wait_for_timeout(wait)
        # a console error caused by a blocked outside host is the network policy, not Lune
        errs = [e for e in errs if not (e.startswith("console Failed to load resource") and outside)]
        if errs:
            bad.append((name, errs[:3]))
        ctx.close()
    check(f"console: {len(SCREENS)} screens with no page errors, console errors or failed requests to Lune", not bad, bad)
    print(f"      (outside hosts this environment could not reach: {', '.join(sorted(outside)) or 'none'})")


# ---------------------------------------------------------------- account (Lune AI for signed-in people)

ACCOUNT_SERVER = "http://127.0.0.1:8140"  # node workers/lune-ai/local-server.mjs: the real Worker, stand-in model
# LUNE_CONFIG is set by lune-config.js; this points its aiServer at the local Worker before anything reads it
POINT_AT_SERVER = """(() => { let c; Object.defineProperty(window, 'LUNE_CONFIG', { configurable: true,
  get: () => c, set: (v) => { c = Object.assign(v, { aiServer: '%s' }); } }); })();""" % ACCOUNT_SERVER
SIGN_IN = """() => { LuneStore.status = () => ({ signedIn: true, mode: 'cloud', email: 't@example.com', userId: 'u-test', cloud: true });
  LuneStore.accessToken = async () => window.__token || 'test-token'; LuneAsk.paintNews(); }"""


def section_account(browser):
    ctx = browser.new_context(viewport={"width": 1280, "height": 860})
    ctx.add_init_script(POINT_AT_SERVER)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    downloads = []
    pg.on("request", lambda r: downloads.append(r.url) if "huggingface" in r.url or "jsdelivr" in r.url else None)

    # a guest: the landing page tells the story first, with Lune AI's examples, then Install
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(300)
    hero = pg.evaluate("() => [...document.querySelectorAll('#hero button')].map(b => b.textContent.trim()).filter(t => t && !/scroll/i.test(t))")
    check("landing: the opening screen has no sign-in or install buttons, only the Lune AI pill", hero == ["New · Lune AI, built into Lune"], hero)
    order = pg.evaluate("""() => { const ids = [...document.querySelectorAll('#home-guest > section, #home-guest > div')].map(e => e.id).filter(Boolean);
      return [ids.indexOf('features'), ids.indexOf('ai'), ids.indexOf('compare'), ids.indexOf('free'), ids.indexOf('get-lune')]; }""")
    check("landing: features, Lune AI, the comparison and No payments come before Get Lune", order[0] >= 0 and order[0] < order[1] < order[2] < order[3] < order[4], order)
    cmp = pg.evaluate("""() => ({ rows: [...document.querySelectorAll('#compare tbody th')].map(t => t.textContent),
      theyWin: [...document.querySelectorAll('#compare .lp-they-win th')].map(t => t.textContent),
      fine: document.querySelector('#compare .lp-compare-fine').textContent, names: document.querySelector('#compare thead').textContent })""")
    check("landing: the comparison names flowkey, Simply Piano, Yousician and Skoove", all(n in cmp["names"] for n in ("flowkey", "Simply Piano", "Yousician", "Skoove")), cmp["names"])
    check("landing: it says plainly what they do better (listening as you play, beginner courses)", cmp["theyWin"] == ["Listening as you play", "Courses from the first note"], cmp["theyWin"])
    check("landing: it dates its sources and says Lune is not connected with them", "October 2026" in cmp["fine"] and "not connected" in cmp["fine"], cmp["fine"])
    check("landing: no best, first or only claims in the comparison",
          not pg.evaluate("() => /\\b(best|first|only|number one|#1)\\b/i.test(document.getElementById('compare').innerText.replace(/first note/gi, ''))"))
    free = pg.text_content("#free")
    check("landing: No payments says no subscription, no ads and Lune AI included", "No payments" in free and "No subscription" in free and "No ads" in free and "Lune AI is free" in free, free[:200])
    scenes = pg.eval_on_selector_all("#ai .ai-scene h3", "els => els.map(e => e.textContent)")
    check("landing: six Lune AI scenarios, each with an example conversation", len(scenes) == 6 and pg.locator("#ai .ai-scene .ai-you").count() == 6 and pg.locator("#ai .ai-scene .ai-lune").count() == 6, scenes)
    truth = pg.text_content("#ai .ai-truth")
    check("landing: Lune AI is named for what it is: Llama 3.3 70B, open-weight, free with an account",
          "Llama 3.3 70B" in truth and "open-weight" in truth and "free with a Lune account" in truth and "Built with Llama" in truth and "can be wrong" in truth, truth)
    check("landing: nothing claims a model made or trained for Lune",
          not pg.evaluate("() => /original (ai|llm|model)|trained (for|on) lune|our own (ai|model)|built (for|by) lune from scratch/i.test(document.getElementById('home-guest').textContent)"))
    close = pg.eval_on_selector_all("#get-lune button", "els => els.map(e => e.textContent.trim())")
    check("landing: the end offers Install first, then the browser, and no sign-in", close == ["Install Lune", "Use it in your browser"], close)
    pg.click("#hero [data-show-ai]")
    # a smooth scroll, then one re-landing once the demos above have drawn
    pg.wait_for_timeout(3000)
    check("landing: the pill scrolls to Lune AI without changing the address",
          pg.evaluate("() => location.hash === '' && Math.abs(document.getElementById('ai').getBoundingClientRect().top) < 120"),
          pg.evaluate("() => [location.hash, document.getElementById('ai').getBoundingClientRect().top]"))
    credit = pg.evaluate("() => !document.querySelector('[data-ai-credit]').hidden")
    check("account: the credits name the model and its licence", credit)

    # the app: sign-in lives here, with search and pieces to start with
    pg.evaluate("() => document.querySelector('[data-enter-app]').click()")
    pg.wait_for_timeout(500)
    app = pg.evaluate("""() => ({ on: document.body.classList.contains('is-app'), story: !!document.getElementById('hero').offsetParent,
      signin: document.querySelector('#home-app [data-lp-signin-only]')?.textContent.trim(), pieces: document.querySelectorAll('#home-app .home-app-pieces button').length,
      search: !document.getElementById('btn-search').hidden, ai: document.querySelector('#home-app [data-ai-home] [data-lp-signin-only]')?.textContent.trim() })""")
    check("app: Use it in your browser opens the app home, not the story", app["on"] and not app["story"], app)
    check("app: sign-in is offered inside the app, with search and pieces to start", app["signin"] == "Sign in or create an account" and app["pieces"] == 4 and app["search"], app)
    check("app: the Lune AI section says what it does and how to turn it on", app["ai"] == "Sign in to use Lune AI", app)
    pg.click("#home-app [data-show-compare]")
    pg.wait_for_timeout(1800)
    check("app: How Lune compares opens the comparison from the app home",
          pg.evaluate("() => !!document.getElementById('compare').offsetParent && Math.abs(document.getElementById('compare').getBoundingClientRect().top) < 140"))
    pg.evaluate("() => document.querySelector('[data-enter-app]').click()")
    pg.wait_for_timeout(400)
    pg.reload(wait_until="networkidle")
    check("app: the choice is remembered", pg.evaluate("() => document.body.classList.contains('is-app')"))
    pg.evaluate("() => LuneAsk.openChat()")
    pg.wait_for_selector("#lune-chat[open]")
    pg.wait_for_timeout(400)
    check("chat: without an account, Chat with Lune says it needs one and offers sign-in",
          pg.locator("#chat-locked").is_visible() and not pg.locator("#chat-form").is_visible() and "free with a Lune account" in pg.inner_text("#chat-locked"))
    pg.keyboard.press("Escape")
    pg.evaluate("() => localStorage.removeItem('lune.app')")

    open_piece(pg)
    select_bar(pg, 5)
    pg.evaluate("() => LuneAsk.open({bar: 5})")
    pg.wait_for_timeout(500)
    offer = pg.inner_text("#ask-ai-offer") if pg.locator("#ask-ai-offer").is_visible() else ""
    check("account: Ask Lune invites a guest to make an account, with no download", "Create a free account" in offer and "Download" not in offer, offer)
    check("account: no model chips for a guest", pg.locator("#ask-chips [data-task]").count() == 0)
    pg.click("[data-ai-account]")
    pg.wait_for_timeout(500)
    check("account: that button opens account creation", pg.evaluate("() => !!document.querySelector('dialog[open]')"))
    pg.keyboard.press("Escape")

    # signed in: Lune AI is on with nothing to set up
    pg.evaluate(SIGN_IN)
    pg.evaluate("() => { LuneAsk.close(); LuneAsk.open({bar: 5}); }")
    pg.wait_for_timeout(400)
    fine = pg.inner_text("#ask-fine")
    check("account: signed in, Ask Lune says Lune AI is on and where questions go", fine.startswith("Lune AI is on") and "Lune’s server stores none of it" in fine and "saved only in this browser" in fine, fine)
    tasks = pg.eval_on_selector_all("#ask-chips [data-task]", "els => els.map(e => e.dataset.task)")
    check("account: the model actions appear", tasks == ["explainBar", "whyHard", "suggestPractice", "explainFingering"], tasks)
    pg.evaluate("() => LuneAsk.ask('What notes are in this bar?')")
    pg.wait_for_function("() => document.querySelector('#ask-log .ask-msg[data-via=model]')", timeout=15000)
    last = pg.evaluate("() => [...document.querySelectorAll('#ask-log .ask-msg')].pop().textContent")
    check("account: a question is answered by Lune AI through the server", last == "STANDIN account reply about bar 5.", last)
    import urllib.request as _u

    sent = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
    check("account: the server, not the browser, supplies the system prompt", sent["messages"][0]["content"].startswith("You are Lune, a piano practice"))
    pg.evaluate("() => { LuneAsk.runTask('whyHard', 5); }")
    pg.wait_for_timeout(1500)
    last = pg.evaluate("() => [...document.querySelectorAll('#ask-log .ask-msg')].pop().textContent")
    check("account: Why is this hard? goes to Lune AI too", last == "STANDIN account reply about bar 5.", last)

    # a token the server rejects: the built-in reply, with the server's reason
    pg.evaluate("() => { window.__token = 'expired'; }")
    pg.evaluate("() => LuneAsk.ask('What is the fingering?')")
    pg.wait_for_timeout(1500)
    msgs = pg.eval_on_selector_all("#ask-log .ask-msg", "els => els.map(e => e.textContent)")
    check("account: a rejected sign-in falls back to the built-in reply and says why",
          any("Sign in to Lune to use Lune AI. This is Lune’s built-in reply." in m for m in msgs), msgs[-2:])
    pg.evaluate("() => { window.__token = null; }")

    # Chat with Lune: Repertoire, plans and week as context, the conversation carried along
    pg.evaluate("() => { LuneAsk.close(); localStorage.removeItem('lune.chat.v1'); localStorage.removeItem('lune.chats.v2'); LuneAsk.openChat(); }")
    pg.wait_for_selector("#lune-chat[open] #chat-form")
    starters = pg.eval_on_selector_all("#chat-starters button", "els => els.map(e => e.textContent)")
    check("chat: signed in, the chat opens with starter questions", "Summarise my week" in starters, starters)
    pg.click("#chat-starters button:has-text('Summarise my week')")
    pg.wait_for_function("() => document.querySelectorAll('#chat-log .chat-from-lune').length >= 1 && !document.querySelector('.chat-wait')", timeout=15000)
    sent = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
    body = sent["messages"][1]["content"]
    check("chat: the question goes to Lune AI with the week, plans and Repertoire",
          body.endswith("QUESTION: Summarise my week") and '"thisWeek"' in body and '"plans"' in body and '"repertoire"' in body, body[-300:])
    pg.fill("#chat-input", "And next week?")
    pg.press("#chat-input", "Enter")
    pg.wait_for_function("() => document.querySelectorAll('#chat-log .chat-from-lune').length >= 2 && !document.querySelector('.chat-wait')", timeout=15000)
    sent = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
    convo = json.loads(sent["messages"][1]["content"].split("CONTEXT:\n", 1)[1].rsplit("\n\nQUESTION:", 1)[0]).get("conversation")
    check("chat: a follow-up carries the earlier turns", convo and convo[0] == {"from": "pianist", "text": "Summarise my week"} and convo[1]["from"] == "lune", convo)
    check("chat: answers from the model can be read aloud", pg.locator("#chat-log .chat-say").count() == 2)
    pg.keyboard.press("Escape")

    pg.evaluate("() => document.getElementById('btn-settings').click()")
    pg.wait_for_timeout(500)
    check("chat: Settings has Chat with Lune", pg.locator("[data-set=chat]").count() == 1)
    st = pg.inner_text("#set-account-ai")
    check("account: Settings says Lune AI is on", st.startswith("Lune AI is on"), st)
    check("account: nothing was downloaded from Hugging Face or a CDN", not downloads, downloads[:3])
    check("account: no page errors", not pg.errors, pg.errors[:3])
    ctx.close()


# ---------------------------------------------------------------- main

# ---------------------------------------------------------------- latest (the owner's October list)


def section_latest(browser):
    pg = new_page(browser)
    pg.goto(BASE, wait_until="networkidle")
    merge = pg.evaluate("""() => {
      const local = { tasks: [{ id: 'a', done: false, created_at: '2026-10-01', updated_at: '2026-10-01' }, { id: 'b', done: false, created_at: '2026-10-02' }], removedTaskIds: [] };
      const remote = { planTasks: [{ id: 'a', done: true, created_at: '2026-10-01', done_at: '2026-10-03' }, { id: 'c', done: false, created_at: '2026-10-04' }, { id: 'd', created_at: '2026-10-04' }], removedTaskIds: ['d'] };
      const changed = LuneStore.mergePlanTasks(local, remote);
      return { changed, ids: local.tasks.map(t => t.id + (t.done ? '+' : '')), gone: local.removedTaskIds };
    }""")
    check("plans: tasks from another device are merged in, newest first", merge["changed"] and merge["ids"] == ["c", "b", "a+"], merge)
    check("plans: a task finished on another device stays finished, a removed one stays removed", "a+" in merge["ids"] and "d" not in merge["ids"] and "d" in merge["gone"], merge)
    cloud = pg.evaluate("() => Object.keys(LuneStore.prefsForCloud())")
    check("plans: plans are part of what an account keeps", "planTasks" in cloud and "removedTaskIds" in cloud, cloud)

    tempo = pg.evaluate("""() => [['Allegro', '4/4'], ['Andante con moto', '4/4'], ['Adagio', '3/4'], ['Allegretto', '6/8'], ['Con moto', '4/4'], ['dolce', '4/4']]
      .map(([w, ts]) => { const n = tempoFromWords(w, ts); return Number.isNaN(n) ? null : n; })""")
    check("tempo: a tempo word gives a beat when the score has no number", tempo[0] == 132 and tempo[1] == 80 and tempo[2] == 66 and tempo[3] == 162 and tempo[4] == 128, tempo)
    check("tempo: words that are not tempo marks give nothing", tempo[5] is None, tempo)

    answers = pg.evaluate("""() => ['vision', 'I have dyslexia', 'both', 'neither', 'No visual impairment', 'not dyslexic, but low vision', 'hello']
      .map(t => LuneOnboard.parseAccessAnswer(t))""")
    check("setup: spoken answers are understood, including no", answers == ["vision", "dyslexia", "both", "none", "none", "vision", None], answers)

    check("Play along is gone", pg.evaluate("() => !document.querySelector('script[src*=\"follow.js\"]') && typeof window.LuneFollow === 'undefined'"))

    # This week explains itself and has an example on Home
    pg.evaluate("() => document.getElementById('btn-member-week-example').click()")
    pg.wait_for_selector("#example-week-dialog[open]")
    kick = pg.text_content("#example-week-dialog .auth-kicker")
    flag = pg.inner_text("#example-week-dialog .example-flag")
    check("week: Home opens an example week, labelled as an example", kick.startswith("Example · 1 of 7") and "Nothing here is saved" in flag, kick)
    seen = []
    for _ in range(6):
        pg.click("#example-week-dialog [data-ex=next]")
        seen.append(pg.inner_text("#example-week-dialog h2"))
    check("week: the example covers setting the week, sharing it and inviting", "What a teacher or parent sees" in seen and "Bring someone with you" in seen, seen)
    pg.keyboard.press("Escape")
    how = pg.evaluate("() => [...document.querySelectorAll('.member-week-how li')].map(li => li.textContent).join(' ')")
    check("week: Home says what Share this week and Invite do", "read-only page" in how and "Invite" in how, how)

    # voice: without Lune AI's server, the device voice and device listening are used
    off = browser.new_context(viewport={"width": 1280, "height": 860})
    off.add_init_script(POINT_AT_SERVER.replace(ACCOUNT_SERVER, ""))
    p2 = off.new_page()
    p2.goto(BASE, wait_until="networkidle")
    check("voice: with no Lune AI server, the server voice is not offered", p2.evaluate("() => LuneAsk.voice.available() === false"))
    off.close()

    # the Reading and access card on a piece's overview
    errors = pg.errors
    pg = new_page(browser)
    open_piece(pg)
    pg.evaluate("() => document.getElementById('tab-explain').click()")
    pg.wait_for_timeout(900)
    pg.wait_for_function("() => !document.getElementById('btn-braille-explain').hidden || !document.getElementById('braille-none-explain').hidden", timeout=15000)
    card = pg.evaluate("""() => { const c = document.getElementById('explain-access');
      const on = [...c.querySelectorAll('.access-option')].filter(o => !o.hidden && o.offsetParent);
      const b = document.getElementById('btn-braille-explain');
      return { visible: !!c.offsetParent, options: on.map(o => o.querySelector('strong').textContent), brf: b.hidden ? null : b.getAttribute('href') }; }""")
    check("overview: Reading and access is a card with three plain options", card["visible"] and len(card["options"]) == 3, card)
    check("overview: Für Elise offers its braille music file", (card["brf"] or "").endswith(".brf"), card)
    if card["brf"]:
        st = pg.evaluate("(u) => fetch(u).then(r => r.ok ? r.text() : '').then(t => t.length)", card["brf"])
        check("overview: the braille file downloads and is not empty", st > 200, st)
    check("latest: no page errors", not (errors + pg.errors), errors + pg.errors)
    section_playback(browser)


ONSETS = """() => { window.__on = []; window.__sl = []; window.__dock = [];
  const S = Tone.Sampler.prototype.triggerAttack;
  Tone.Sampler.prototype.triggerAttack = function (n, when) { window.__on.push(+when.toFixed(4)); return S.apply(this, arguments); };
  setInterval(() => { const t = document.querySelector('.lune-kbd-track'); const d = document.getElementById('piano-dock');
    window.__sl.push(t ? Math.round(t.scrollLeft) : -1); window.__dock.push(d.hidden ? -1 : Math.round(d.getBoundingClientRect().top)); }, 50); }"""


def section_playback(browser):
    """Playback keeps time, the keyboard keeps still, and the phone score is clean."""
    for width, stall in ((1280, False), (390, True)):
        ctx = browser.new_context(viewport={"width": width, "height": 844 if width < 600 else 900}, is_mobile=width < 600, has_touch=width < 600)
        pg = ctx.new_page()
        samples = []
        pg.on("request", lambda r: samples.append(r.url) if r.url.endswith(".mp3") else None)
        open_piece(pg)
        pg.evaluate(ONSETS)
        dock_before = pg.evaluate("() => { const d = document.getElementById('piano-dock'); return d.hidden ? -1 : Math.round(d.getBoundingClientRect().top); }")
        # on a phone, Play sits in the top bar; it presses the player's own button
        pg.click("#st-play" if width < 900 else "#btn-play-range")
        if stall:
            for _ in range(3):
                pg.wait_for_timeout(2300)
                pg.evaluate("() => { const e = performance.now() + 700; while (performance.now() < e) {} }")
            pg.wait_for_timeout(2500)
        else:
            pg.wait_for_timeout(9000)
        on = sorted(set(pg.evaluate("() => window.__on")))
        gaps = [round(b - a, 3) for a, b in zip(on, on[1:])]
        uneven = [g for g in gaps if abs(g - 0.2083) > 0.003 and abs(g - 0.4167) > 0.003]
        label = f"{width}px" + (", with the page frozen for 0.7 s three times" if stall else "")
        check(f"playback ({label}): every note lands on the beat, no gap between lines", len(on) > 30 and not uneven, (len(on), uneven[:6]))
        dock = set(pg.evaluate("() => window.__dock"))
        check(f"playback ({label}): pressing Play does not move or reveal the keyboard", dock == {dock_before}, (dock_before, sorted(dock)))
        if width >= 1280:
            sl = pg.evaluate("() => window.__sl")
            check("playback: on a computer the keyboard holds still while Für Elise plays", len(set(sl)) == 1, sorted(set(sl))[:6])
        check(f"playback ({label}): the piano sound comes from Lune itself", samples and all("/static/vendor/salamander/" in u for u in samples), samples[:3])
        if width < 600:
            box = pg.evaluate("""() => { const r = (id) => document.getElementById(id).getBoundingClientRect();
              const tools = document.querySelector('.score-tools-head').getBoundingClientRect();
              return { score: Math.round(r('score-scroll').height), tools: Math.round(tools.height), top: Math.round(tools.bottom), vh: innerHeight,
                player: Math.round(r('studio-dock').height), banner: !!document.querySelector('#keep-account-banner')?.offsetParent }; }""")
            check("phone: the score takes most of the screen", box["score"] >= box["vh"] * 0.5, box)
            check("phone: header, tabs and tools fit in about a fifth of the screen, tools on one row of 40 px targets", box["top"] <= 170 and box["tools"] <= 56, box)
            title = pg.evaluate("() => { const t = document.getElementById('studio-piece-quiet'); return [t.textContent, t.scrollWidth <= t.clientWidth + 1]; }")
            check("phone: the piece's name shows in full", title == ["Für Elise", True], title)
            check("phone: the player is one row and the sign-up banner stays off the score", box["player"] <= 80 and not box["banner"], box)
            # with the piano hidden, the bottom holds the metronome and speed, ready to use
            if not pg.evaluate("() => document.getElementById('piano-dock').hidden"):
                pg.evaluate("() => document.getElementById('btn-toggle-kbd').click()")
                pg.wait_for_timeout(300)
            if pg.locator("#bpm-readout-btn").is_visible():
                pg.click("#bpm-readout-btn")
            check("phone: the speed slider and metronome are at hand", pg.locator("#bpm-slider").is_visible() and pg.locator("#btn-metro").is_visible())
            check("phone: the top bar is Menu, Play and +", pg.evaluate("() => ['st-menu','st-play','st-add'].every(id => document.getElementById(id)?.offsetParent)"))
        ctx.close()


def section_voice(browser):
    """The microphone: Lune AI listens even where the browser has no speech recognition of its own."""
    import urllib.request as _u
    for signed in (True, False):
        ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
        ctx.grant_permissions(["microphone"], origin=BASE.rsplit("/lune/", 1)[0])
        ctx.add_init_script(POINT_AT_SERVER)
        # like Firefox, or Lune installed on an iPhone: no built-in speech recognition
        ctx.add_init_script("window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;")
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
        open_piece(pg)
        if signed:
            pg.evaluate(SIGN_IN)
        pg.evaluate("() => LuneAsk.open({bar: 12})")
        pg.wait_for_timeout(300)
        pg.click("#ask-mic")
        pg.wait_for_timeout(300)
        guest_note = pg.evaluate("() => document.body.innerText")
        # the test microphone only beeps now and then; enough of it to count as a phrase
        pg.wait_for_timeout(3200)
        # still listening: Done in the listening bar; already finished: nothing to press
        if pg.locator('#ask-listen [data-listen="done"]').is_visible():
            pg.click('#ask-listen [data-listen="done"]')
        pg.wait_for_timeout(2500)
        # once you stop speaking it is sent: the words are the newest question in the panel
        said = pg.evaluate("() => (() => { const y = [...document.querySelectorAll('#ask-log .ask-from-you')].pop(); return y ? y.textContent : document.getElementById('ask-input').value; })()")
        if signed:
            got = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
            check("voice: signed in, the microphone works without the browser's speech recognition", said == "Bar 12, keep the thumb light.", said)
            check("voice: the recording reaches Whisper as WAV, in English", got.get("format") == "RIFF" and got.get("language") == "en" and got.get("bytes", 0) > 8000, got)
        else:
            check("voice: a guest in such a browser is told that signing in turns voice on", "Sign in (free) and Lune AI listens for you" in guest_note)
        check("voice: no page errors", not pg.errors, pg.errors)
        ctx.close()


PROGRESS_SEED = """(rows) => {
  const d = JSON.parse(localStorage.getItem('lune.local.v1') || '{"v":1}');
  d.v = 1; d.activity = rows.activity || []; d.tasks = rows.tasks || []; d.cards = []; d.repertoire = d.repertoire || [];
  localStorage.setItem('lune.local.v1', JSON.stringify(d));
  return LuneStore.weekSnapshot();
}"""


def section_progress(browser):
    """This week counts what Lune records, the same way on every device, and never contradicts itself."""
    pg = new_page(browser)
    pg.goto(BASE, wait_until="networkidle")
    week = pg.evaluate("() => LuneStore.weekStartKey()")
    today = pg.evaluate("() => LuneStore.dayKey()")
    now = pg.evaluate("() => new Date().toISOString()")
    seed = lambda rows: pg.evaluate(PROGRESS_SEED, rows)
    rev = lambda i, piece="fe", bar=7, grade="hard", day=today, wk=week: {"id": i, "kind": "review", "piece_key": piece, "bar": bar, "grade": grade, "mins": 0, "day": day, "week": wk, "created_at": now}

    s = seed({})
    check("progress: no activity reads as zero everywhere", (s["days"], s["ratings"], s["tasksDone"], s["sessions"], s["mins"]) == (0, 0, 0, 0, 0), s)
    s = seed({"activity": [rev("r1")]})
    check("progress: one bar rated is one practice day, one rating, one session", (s["days"], s["ratings"], s["hard"], s["sessions"]) == (1, 1, 1, 1), s)
    s = seed({"activity": [rev("r1"), rev("r2", bar=8, grade="good"), rev("r3", bar=9, grade="okay")]})
    check("progress: three bars rated in one piece on one day are one session, not three", (s["days"], s["ratings"], s["sessions"], s["good"], s["okay"], s["hard"]) == (1, 3, 1, 1, 1, 1), s)
    s = seed({"tasks": [{"id": "t1", "piece_key": "fe", "bars": [7], "done": True, "done_at": now, "created_at": now, "plan": {"source": "ask"}}]})
    check("progress: a task finished with no session recorded (another device, older data) still counts its day", (s["days"], s["tasksDone"], s["sessions"]) == (1, 1, 1), s)
    s = seed({"activity": [rev("r1"), {"id": "k1", "kind": "task", "piece_key": "fe", "bar": None, "grade": None, "mins": 0, "day": today, "week": week, "created_at": now}],
              "tasks": [{"id": "t1", "piece_key": "fe", "bars": [7], "done": True, "done_at": now, "created_at": now}]})
    check("progress: a rated bar and a finished task in the same piece and day are one day and one session", (s["days"], s["sessions"], s["tasksDone"], s["ratings"]) == (1, 1, 1, 1), s)
    s = seed({"activity": [{"id": "o1", "kind": "follow", "piece_key": "fe", "bar": None, "grade": None, "mins": 0, "day": today, "week": week, "created_at": now}]})
    check("progress: only real practice evidence counts (old Play along rows do not)", s["days"] == 0, s)

    # week boundaries, in the pianist's own time zone: Sunday night and Monday morning are different weeks
    b = pg.evaluate("""() => { const sun = new Date(2026, 9, 4, 23, 30), mon = new Date(2026, 9, 5, 0, 15);
      return [LuneStore.weekStartKey(sun), LuneStore.weekStartKey(mon), LuneStore.dayKey(sun), LuneStore.dayKey(mon)]; }""")
    check("progress: Sunday 23:30 and Monday 00:15 fall in different weeks, by local time", b == ["2026-09-28", "2026-10-05", "2026-10-04", "2026-10-05"], b)
    s = seed({"activity": [rev("old", day="2026-09-20", wk="2026-09-14")]})
    check("progress: last week's rating is not this week's", s["days"] == 0 and s["ratings"] == 0, s)

    # another device's practice arrives through the account, once
    s = seed({"activity": [rev("r1")]})
    merged = pg.evaluate("""(r) => { const d = { activity: [r[0]] };
      const first = LuneStore.mergeActivity(d, { recentActivity: [r[0], r[1]] });
      const again = LuneStore.mergeActivity(d, { recentActivity: [r[0], r[1]] });
      return [first, again, d.activity.map(x => x.id)]; }""", [rev("r1"), rev("r2", bar=12, grade="good")])
    check("progress: another device's ratings are added once and never doubled", merged == [True, False, ["r1", "r2"]], merged)
    sent = pg.evaluate("() => (LuneStore.prefsForCloud().recentActivity || []).map(r => [r.id, 'mins' in r])")
    check("progress: recent practice evidence travels with the account (ids, no minutes)", sent == [["r1", False]], sent)

    # the review screen states what it counts and does not show unmeasured numbers
    seed({"activity": [rev("r1")], "tasks": [{"id": "t1", "piece_key": "fe", "bars": [7], "done": True, "done_at": now, "created_at": now}]})
    pg.evaluate("() => LuneImpact.openWeeklyReview()")
    pg.wait_for_selector("#weekly-review-dialog[open]")
    text = pg.inner_text("#weekly-review-dialog")
    check("progress: This week shows practice days, bars rated and tasks finished", "practice days" in text and "bar rated" in text and "task finished" in text, text[:300])
    check("progress: it says what a day is and that Lune does not time practice", "rated a bar or finished a task" in text and "does not time your practice" in text)
    check("progress: no sessions or minutes figures that Lune does not measure", "sessions" not in text and "minutes logged" not in text)
    check("progress: no page errors", not pg.errors, pg.errors)


NEXT_SEED = """(o) => {
  const d = JSON.parse(localStorage.getItem('lune.local.v1') || '{"v":1}');
  d.v = 1; d.tasks = o.tasks || []; d.cards = o.cards || []; d.repertoire = o.repertoire || []; d.activity = [];
  d.prefs = Object.assign(d.prefs || {}, { dreamPiece: o.dream || null });
  localStorage.setItem('lune.local.v1', JSON.stringify(d));
  if (o.tabs) localStorage.setItem('lune.tabs', JSON.stringify(o.tabs)); else localStorage.removeItem('lune.tabs');
  return LunePractice.nextAction();
}"""


def section_home(browser):
    """The signed-in home leads with one next step, chosen from real data, and says why."""
    ctx = browser.new_context(viewport={"width": 375, "height": 800}, is_mobile=True, has_touch=True)
    ctx.add_init_script(POINT_AT_SERVER)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    pg.goto(BASE, wait_until="networkidle")
    now = pg.evaluate("() => Date.now()")
    iso = pg.evaluate("() => new Date().toISOString()")
    past = pg.evaluate("() => new Date(Date.now() - 864e5).toISOString()")
    nx = lambda o: pg.evaluate(NEXT_SEED, o)
    piece = lambda k, t, st="learning": {"piece_key": k, "title": t, "composer": "", "status": st, "created_at": past}
    task = {"id": "t1", "piece_key": "fe", "title": "Für Elise", "bars": [12, 13], "done": False, "created_at": iso, "plan": {"source": "ask"}}
    card = {"piece_key": "cl", "bar": 9, "ease": 2.3, "interval_days": 1, "reps": 1, "lapses": 1, "due_at": past, "last_grade": "hard", "updated_at": past}

    n = nx({"tabs": {"tabs": [{"id": "beethoven-fur-elise", "title": "Für Elise", "panel": "score"}], "active": "beethoven-fur-elise", "at": now - 3600e3}, "tasks": [task]})
    check("home: a piece left open within the last 12 hours comes first", n["kind"] == "resume" and n["title"] == "Für Elise" and "earlier today" in n["why"], n)
    n = nx({"tabs": {"tabs": [{"id": "beethoven-fur-elise", "title": "Für Elise", "panel": "score"}], "active": "beethoven-fur-elise", "at": now - 30 * 3600e3}, "tasks": [task]})
    check("home: a tab left open yesterday does not hide today's plan", n["kind"] == "task", n)
    check("home: a plan task names its bars, and built-in steps are not credited to Lune AI", n["label"] == "Practise bars 12, 13" and n["why"].startswith("Lune’s built-in rules suggested"), n)
    n = nx({"tasks": [dict(task, plan={"source": "ask", "ai": "1. Bar 12 slowly."})]})
    check("home: a plan written by Lune AI says so, and asks to be checked", n["why"].startswith("Lune AI planned this") and "Check it against the score" in n["why"], n)
    n = nx({"tasks": [dict(task, plan={"source": "repertoire"})]})
    check("home: bars you chose with Lune's steps say exactly that", n["why"].startswith("You chose these bars"), n)
    n = nx({"tasks": [dict(task, plan={"source": "self"})]})
    check("home: a task you added says you added it", n["why"].startswith("You added this"), n)
    n = nx({"cards": [card], "repertoire": [piece("cl", "Clair de lune")]})
    check("home: with no plan, a bar that is due again comes next, with how it was rated", n["kind"] == "review" and n["label"] == "Review bar 9" and "Hard" in n["why"] and n["title"] == "Clair de lune", n)
    n = nx({"repertoire": [piece("cl", "Clair de lune", "ready"), piece("fe", "Für Elise", "learning")]})
    check("home: otherwise the piece marked Learning", n["kind"] == "learning" and n["title"] == "Für Elise", n)
    n = nx({"dream": {"title": "Ballade No. 1", "composer": "Chopin"}})
    check("home: otherwise the dream piece you named", n["kind"] == "dream" and n["title"] == "Ballade No. 1", n)
    n = nx({})
    check("home: a new pianist is asked to choose a piece, with nothing invented", n["kind"] == "new" and n["label"] == "Find a score", n)

    nx({"tasks": [task]})
    pg.evaluate(SIGN_IN)
    pg.evaluate("() => { document.getElementById('home-guest').hidden = true; document.getElementById('home-member').hidden = false; document.body.classList.add('is-signed-in'); LuneOnboard.paintSignedHome(); }")
    pg.wait_for_function("() => document.getElementById('member-next').dataset.kind === 'task'", timeout=8000)
    lay = pg.evaluate("""() => { const r = (s) => document.querySelector(s).getBoundingClientRect();
      return { nextTop: r('#member-next').top, recsTop: r('#member-recs').top, aiTop: r('.member-ai').top, vh: innerHeight,
        tour: !!document.querySelector('#home-member .member-features'), btn: r('[data-next-go]').height, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        primaries: [...document.querySelectorAll('#home-member .primary')].filter(b => b.offsetParent && b.getBoundingClientRect().top < innerHeight).length }; }""")
    check("home: the next step is on the first screen, above suggestions and Lune AI", lay["nextTop"] < lay["vh"] * 0.5 and lay["nextTop"] < lay["recsTop"] < lay["aiTop"], lay)
    check("home: one primary button on the first screen, at least 44 px tall", lay["primaries"] == 1 and lay["btn"] >= 44, lay)
    check("home: no feature tour on the signed-in home, no sideways scrolling", not lay["tour"] and not lay["overflow"], lay)
    # signed in, the comparison is one tap away: from the footer and from Settings
    pg.click("#home-member [data-show-compare]")
    pg.wait_for_timeout(1800)
    seen = pg.evaluate("() => { const c = document.getElementById('compare'); const r = c.getBoundingClientRect(); return { visible: !!c.offsetParent, top: Math.round(r.top) }; }")
    check("home: signed in, How Lune compares opens the comparison", seen["visible"] and abs(seen["top"]) < 140, seen)
    pg.evaluate("() => document.getElementById('btn-home').click()")
    pg.wait_for_timeout(400)
    pg.evaluate("() => document.getElementById('btn-settings').click()")
    pg.wait_for_timeout(400)
    check("home: Settings has How Lune compares", pg.locator("[data-set=compare]").count() == 1)
    pg.click("[data-set=compare]")
    pg.wait_for_timeout(1800)
    check("home: from Settings it lands on the comparison", pg.evaluate("() => !!document.getElementById('compare').offsetParent && Math.abs(document.getElementById('compare').getBoundingClientRect().top) < 140"))
    check("home: no page errors", not pg.errors, pg.errors)
    ctx.close()


def section_practice_loop(browser):
    """One whole practice path: open a piece, pick a bar, hear it, plan it, rate it, and see it on Home and in This week."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    pg.goto(BASE, wait_until="networkidle")
    pg.evaluate("() => { localStorage.removeItem('lune.local.v1'); localStorage.removeItem('lune.tabs'); }")
    open_piece(pg)
    select_bar(pg, 12)
    check("loop: a bar can be selected and its panel opens", pg.evaluate("() => state.coachOpen && selectedBarsSorted()[0] === 12"))
    played = pg.evaluate("async () => { await playSelectedBars(); await new Promise(r => setTimeout(r, 600)); const p = LunePiano.isPlaying(); LunePiano.stop?.(); return p; }")
    check("loop: the selected bar plays", played)
    pg.evaluate("() => LuneAsk.open({bar: 12})")
    pg.evaluate("() => LuneAsk.ask('Make a plan')")
    pg.wait_for_timeout(1200)
    tasks = pg.evaluate("() => LuneStore.listTasks().map(t => [t.piece_key, t.bars, t.plan?.source, !!t.plan?.ai, t.done])")
    check("loop: Make a plan saves a task for bar 12, made by Lune's built-in rules (no model here)", tasks and 12 in tasks[0][1] and tasks[0][2] == "ask" and not tasks[0][3] and not tasks[0][4], tasks)
    src = pg.eval_on_selector_all("#ask-log .ask-src", "els => els.map(e => e.textContent)")
    check("loop: Ask Lune labels where its answers come from", src and all(x in ("Built-in answer, read from the score", "Lune") for x in src), src)
    pg.evaluate("() => LuneAsk.close()")
    pg.evaluate("() => LuneAsk.ask('What is the fingering?')")
    pg.wait_for_timeout(400)
    fing = pg.evaluate("() => [...document.querySelectorAll('#ask-log .ask-msg')].pop().textContent")
    check("loop: fingering is called suggested fingering, and the edition may differ", fing.startswith("Suggested fingering") and "edition may print different fingers" in fing, fing[:200])
    pg.evaluate("() => LuneAsk.close()")
    select_bar(pg, 12)
    pg.click("#coach .lp-grade[data-grade=hard]")
    pg.wait_for_timeout(800)
    snap = pg.evaluate("() => LuneStore.weekSnapshot()")
    check("loop: rating bar 12 Hard is one practice day and one Hard rating this week", snap["days"] == 1 and snap["ratings"] == 1 and snap["hard"] == 1, snap)
    card = pg.evaluate("async () => (await LuneStore.listCards()).find(c => c.bar === 12)")
    check("loop: the Hard bar is scheduled to come back", card and card["last_grade"] == "hard" and card["due_at"] > pg.evaluate("() => new Date().toISOString()"), card)
    pg.evaluate("() => localStorage.removeItem('lune.tabs')")
    n = pg.evaluate("() => LunePractice.nextAction()")
    check("loop: Home's next step is the plan just made, for bar 12", n["kind"] == "task" and "12" in n["label"], n)
    pg.evaluate("() => LuneImpact.openWeeklyReview()")
    pg.wait_for_selector("#weekly-review-dialog[open]")
    wk = pg.inner_text("#weekly-review-dialog")
    check("loop: This week shows the day, the rating and the plan, with nothing contradictory", "1\npractice days" in wk.replace("\n\n", "\n") or "practice days" in wk, wk[:200])
    pg.keyboard.press("Escape")
    rep_ok = pg.evaluate("""async () => { await LunePractice.showRepertoire(); await new Promise(r => setTimeout(r, 600));
      const card = document.querySelector('#rep-today .rep-plan-card, .rep-plan-card'); if (!card) return null;
      return { origin: card.querySelector('.task-origin').textContent, primary: card.querySelector('.rep-plan-actions .primary').textContent,
        remove: card.querySelector('[data-task-remove]').className }; }""")
    check("loop: in Repertoire the plan says who made it and leads with practising the bars", rep_ok and rep_ok["origin"] == "Suggested by Lune" and rep_ok["primary"].startswith("Practise bar"), rep_ok)
    check("loop: Remove is a quiet link, not a third equal button", rep_ok and "link-btn" in rep_ok["remove"], rep_ok)
    check("loop: no page errors", not pg.errors, pg.errors)
    ctx.close()


def section_studio(browser):
    """The compact studio on a phone: Menu, Play and + on top, the score following the music, loading never blank."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    # opening a piece link shows the loading screen at once, not a blank page
    pg.goto(PIECE, wait_until="commit")
    try:
        pg.wait_for_function("() => { const l = document.getElementById('lune-loader'); return !!l && getComputedStyle(l).display !== 'none' && !!l.querySelector('.lune-loader-keys'); }", timeout=4000, polling=50)
        shown = True
    except Exception:
        shown = False
    check("studio: a piece link shows the piano loading screen while it opens", shown)
    pg.wait_for_function("() => typeof state !== 'undefined' && state.piece && Object.keys(state.piece.debriefs || {}).length > 0", timeout=60000)
    pg.wait_for_timeout(800)
    check("studio: the loading screen goes once the score is ready", pg.evaluate("() => !document.documentElement.classList.contains('boot-piece')"))
    shown = pg.evaluate("""() => [...document.querySelectorAll('header.bar > *')].filter(e => e.offsetParent && e.getBoundingClientRect().width > 0).map(e => e.id || e.className)""")
    check("studio: the top bar holds Menu, the title, Play and + and little else", all(x in shown for x in ("st-menu", "st-play", "st-add")) and len(shown) <= 6, shown)
    # Play mirrors the player
    pg.click("#st-play")
    pg.wait_for_timeout(1500)
    check("studio: Play turns into Pause while the piece plays", pg.get_attribute("#st-play", "aria-label") == "Pause")
    # the score follows the playhead on its own
    top0 = pg.evaluate("() => document.getElementById('score-scroll').scrollTop")
    pg.evaluate("() => { const s = document.getElementById('score-scroll'); s.scrollTop = 0; }")
    pg.wait_for_timeout(9000)
    follow = pg.evaluate("""() => { const s = document.getElementById('score-scroll'); const h = document.querySelector('.playhead, #playhead, [data-playhead]');
      const r = h ? h.getBoundingClientRect() : null; const v = s.getBoundingClientRect();
      return { top: s.scrollTop, inView: r ? (r.top >= v.top - 4 && r.bottom <= v.bottom + 4) : null }; }""")
    check("studio: the score rolls by itself to keep the playing bar in view", follow["inView"] is not False, follow)
    pg.click("#st-play")
    pg.wait_for_timeout(400)
    check("studio: Pause stops it", pg.get_attribute("#st-play", "aria-label") != "Pause")
    # the menu
    pg.click("#st-menu")
    pg.wait_for_selector("#studio-menu[open]")
    menu = pg.text_content("#studio-menu")
    check("studio: the menu has the panels, open pieces, annotations and actions",
          all(w in menu for w in ("Score", "Explain", "Piano", "Open pieces", "Für Elise", "Notes", "Fingers", "Piano keys", "Ask about this bar", "Lune AI chat", "Settings")), menu[:200])
    kbd = lambda: pg.evaluate("() => !document.getElementById('piano-dock').hidden")
    before = kbd()
    pg.click('#studio-menu [data-m="kbd"]')
    pg.wait_for_timeout(300)
    check("studio: Piano keys in the menu shows or hides the keyboard", kbd() != before)
    if kbd():
        pg.click('#studio-menu [data-m="kbd"]')
        pg.wait_for_timeout(300)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(200)
    check("studio: with the piano hidden, the bottom has the metronome and speed", pg.locator("#btn-metro").is_visible() and pg.locator("#bpm-slider").is_visible())
    # + opens search for another piece
    pg.click("#st-add")
    pg.wait_for_timeout(400)
    check("studio: + opens search to add another piece", pg.locator("#q").is_visible() and pg.evaluate("() => document.activeElement && document.activeElement.id === 'q'"))
    pg.fill("#q", "clair")
    pg.wait_for_timeout(900)
    check("studio: search shows pieces to open", pg.locator(".results li, .results [role=option], .results a, .results button").count() > 0)
    check("studio: nothing scrolls sideways", pg.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"))
    check("studio: no page errors", not pg.errors, pg.errors)
    ctx.close()


def section_plans(browser):
    """Progress per piece, summaries after a session, the week plan, sharing, and the voice pieces of Lune AI."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.grant_permissions(["microphone"], origin=BASE.rsplit("/lune/", 1)[0])
    ctx.add_init_script(POINT_AT_SERVER)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    open_piece(pg)
    key = pg.evaluate("() => LunePractice.keyFor(state.piece)")
    # Lune, heard as Loon
    fixed = pg.evaluate("() => ['ask loon about bar 3', 'Loons advice', 'balloon'].map(LunePractice.tidySpoken)")
    check("voice: “Loon” is written as Lune, and other words are left alone", fixed[0].lower().startswith("ask lune about bar 3") and fixed[1].startswith("Lune ") and fixed[2].lower().startswith("balloon"), fixed)
    # the bar panel's "I can play up to here"
    select_bar(pg, 24)
    pg.evaluate("() => document.querySelector('[data-lp=\"upto\"]')?.click()")
    pg.wait_for_timeout(300)
    prog = pg.evaluate("(k) => LunePlans.progressOf(k)", key)
    check("progress: “I can play up to here” on bar 24 marks the piece up to bar 24", bool(prog) and prog.get("upTo") == 24 and prog.get("of", 0) > 24, prog)
    label = pg.evaluate("(k) => LunePlans.progressLabel(LunePlans.progressOf(k))", key)
    check("progress: it reads “Up to bar 24 of N”", label.startswith("Up to bar 24 of "), label)
    # a session with one question and one remark: a summary lands in Repertoire
    pg.evaluate("() => { setBarSelection([12]); }")
    pg.wait_for_timeout(400)
    pg.evaluate("() => LuneAsk.open({bar: 12})")
    pg.wait_for_timeout(300)
    pg.evaluate("() => LuneAsk.ask('What notes are in this bar?')")
    pg.wait_for_timeout(800)
    pg.evaluate("(k) => LunePlans.noteActivity('note', {key: k, title: 'Für Elise'})", key)
    summ = pg.evaluate("() => LunePlans.flushSummary()")
    check("summary: after a session with a question, Lune writes a summary for the piece", bool(summ) and "1 question" in summ["text"] and 12 in summ["bars"], summ)
    check("summary: a built-in summary says so (not credited to Lune AI)", summ and summ["via"] == "rules", summ)
    check("summary: nothing is summarised when nothing was asked or noted", pg.evaluate("() => LunePlans.flushSummary()") is None)
    # Repertoire shows the bar, the summary and the plan button
    pg.evaluate("(k) => LuneStore.addPiece ? LuneStore.addPiece({ piece_key: k, title: 'Für Elise', composer: 'Beethoven', status: 'learning' }) : null", key)
    pg.evaluate("async () => { LuneAsk.close(); await LunePractice.showRepertoire(); }")
    pg.wait_for_timeout(800)
    rep = pg.evaluate("""() => { const v = document.querySelector('.rep-card'); return v ? { bar: !!v.querySelector('.rp-bar[role=progressbar]'),
       now: v.querySelector('.rp-bar')?.getAttribute('aria-valuenow'), sum: v.querySelector('.rep-sum')?.textContent || '' } : null; }""")
    check("repertoire: each piece shows a progress bar with its value", bool(rep) and rep["bar"] and rep["now"] not in (None, "", "0"), rep)
    check("repertoire: the piece shows the last session's summary", bool(rep) and "question" in rep["sum"], rep)
    check("repertoire: + Plan my week is on the page", pg.locator("[data-wp-open]").first.is_visible())
    # the week plan wizard
    pg.click("[data-wp-open]")
    pg.wait_for_selector("#wp-dialog[open]")
    pg.fill("#wp-goal", "Learn bars 1 to 24 of Für Elise hands together")
    pg.click("#wp-dialog button[type=submit]")
    pg.wait_for_function("() => !document.querySelector('#wp-dialog[open]')", timeout=15000)
    pg.wait_for_timeout(600)
    plan = pg.evaluate("() => LunePlans.currentPlan()")
    check("week plan: it makes a plan for each chosen day, from the goal typed", bool(plan) and len(plan["days"]) >= 3 and plan["goal"].startswith("Learn bars 1 to 24") and all(d["items"] for d in plan["days"]), plan and [d["day"] for d in plan["days"]])
    check("week plan: built without a model, it says Planned by Lune", plan and plan["via"] == "rules" and "Planned by Lune" in pg.inner_text("#rep-week-plan"))
    check("week plan: the plan names the piece being learned", plan and any("Für Elise" in (it.get("title") or "") + it.get("text", "") for d in plan["days"] for it in d["items"]), plan and plan["days"][0])
    pg.click("#rep-week-plan [data-wp-day]")
    pg.wait_for_timeout(200)
    check("week plan: a day can be ticked off, and it stays ticked", any(pg.evaluate("() => LunePlans.currentPlan().done").values()))
    parsed = pg.evaluate("() => LunePlans.parseModelPlan('Mon: Für Elise bars 1-8; scales\\nWed: bars 9-16\\nSome chatter', ['Mon','Wed'])")
    check("week plan: a model's plan is read line by line, one day per line", parsed and [d["day"] for d in parsed] == ["Mon", "Wed"] and len(parsed[0]["items"]) == 2, parsed)
    # sharing: a guest is told it needs an account; signed in, Lune does not ask for what it knows
    pg.evaluate("() => LunePlans.sharePlan()")
    pg.wait_for_timeout(300)
    check("share: without an account, sharing says it needs one", "Sharing a link needs a free account" in pg.evaluate("() => document.body.innerText"))
    pg.evaluate(SIGN_IN)
    pg.evaluate("""() => { LuneStore.status = () => ({ signedIn: true, mode: 'cloud', email: 't@example.com', userId: 'u-test', cloud: true });
      window.__shared = []; LuneStore.createShareLink = async (p) => { window.__shared.push(p); return { token: 'tok' + window.__shared.length }; };
      navigator.share = undefined; navigator.clipboard.writeText = async () => {}; }""")
    pg.evaluate("(k) => LunePlans.shareProgress(k, 'Für Elise', 0)", key)
    pg.wait_for_timeout(300)
    asked = pg.evaluate("() => !!document.querySelector('#wp-upto[open]')")
    shared = pg.evaluate("() => window.__shared")
    check("share: progress Lune already knows is shared without asking", not asked and shared and shared[-1]["kind"] == "piece" and shared[-1]["progress"].startswith("Up to bar 24"), (asked, shared))
    pg.evaluate("() => { LunePlans.shareProgress('no-such-piece', 'Gymnopédie', 40); }")  # it waits on the dialog, so not awaited
    pg.wait_for_selector("#wp-upto[open]", timeout=8000)
    check("share: unknown progress asks how far, up to which bar", "How far through Gymnopédie" in pg.inner_text("#wp-upto"))
    pg.click("#wp-upto button[type=submit]", timeout=8000)
    pg.wait_for_timeout(300)
    check("share: then the link carries that answer", pg.evaluate("() => window.__shared.pop().progress").startswith("Up to bar"))
    pg.evaluate("() => LunePlans.sharePlan()")
    pg.wait_for_timeout(300)
    wp = pg.evaluate("() => window.__shared.pop()")
    check("share: the week plan is shared as a Lune link", wp and wp["kind"] == "weekplan" and len(wp["days"]) >= 3, wp and wp.get("kind"))
    page = pg.evaluate("(p) => { const d = document.createElement('div'); LunePlans.renderShare(d, { ...p, displayName: 'Sam' }); return d.innerText; }", wp)
    check("share: the shared plan page shows each day and nothing to tick", "Monday" in page or "Tuesday" in page or "Wednesday" in page, page[:200])
    # dictation: the listening bar with a live waveform, then the words in the box
    open_piece(pg)
    pg.evaluate(SIGN_IN)
    pg.evaluate("() => LuneAsk.open({bar: 12})")
    pg.wait_for_timeout(300)
    pg.click("#ask-mic")
    # the test microphone only beeps now and then; give it enough beeps to count as a phrase
    pg.wait_for_timeout(5000)
    check("voice: while listening, a waveform and timer replace the text box", pg.locator("#ask-listen .lc-wave").is_visible() and pg.locator("#ask-listen .lc-timer").is_visible())
    pg.click('#ask-listen [data-listen="done"]')
    pg.wait_for_timeout(2500)
    sent = pg.evaluate("() => (() => { const y = [...document.querySelectorAll('#ask-log .ask-from-you')].pop(); return y ? y.textContent : document.getElementById('ask-input').value; })()")
    check("voice: once you stop speaking, the words are sent to Lune", sent == "Bar 12, keep the thumb light.", sent)
    # talk: Lune listens, then answers aloud (the round button is voice chat while the box is empty)
    pg.fill("#ask-input", "")
    pg.click("#ask-talk")
    pg.wait_for_selector("#lune-talk[open]")
    pg.wait_for_timeout(800)
    talk = pg.inner_text("#lune-talk")
    check("talk: Talk opens a full screen that listens", "Listening" in talk or "LISTENING" in talk.upper(), talk[:120])
    pg.click('#lune-talk [data-talk="end"]')
    pg.wait_for_timeout(300)
    check("talk: End closes it", not pg.evaluate("() => !!document.querySelector('#lune-talk[open]')"))
    check("plans: no page errors", not pg.errors, pg.errors)
    ctx.close()


def section_voice2(browser):
    """Silence is never sent to be written down; the composer and voice chat look and act like ChatGPT's; + adds a tab anywhere."""
    import urllib.request as _u
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.grant_permissions(["microphone"], origin=BASE.rsplit("/lune/", 1)[0])
    ctx.add_init_script(POINT_AT_SERVER)
    # a microphone that hears nothing at all
    ctx.add_init_script("""navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const o = c.createOscillator(); const g = c.createGain(); g.gain.value = 0;
      const d = c.createMediaStreamDestination(); o.connect(g); g.connect(d); o.start(); return d.stream; };""")
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    open_piece(pg)
    pg.evaluate(SIGN_IN)
    pg.evaluate("() => { LuneAsk.openChat(); }")
    pg.wait_for_selector("#lune-chat[open] #chat-form")
    check("composer: with an empty box, the round button is voice chat", pg.locator("#chat-talk").is_visible() and not pg.locator("#chat-composer .lc-send").is_visible())
    pg.fill("#chat-input", "Hello")
    check("composer: once there is text, it becomes Send", pg.locator("#chat-composer .lc-send").is_visible() and not pg.locator("#chat-talk").is_visible())
    pg.fill("#chat-input", "")
    before = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
    pg.click("#chat-mic")
    pg.wait_for_timeout(2500)
    check("dictation: a waveform shows while listening", pg.locator("#chat-listen .lc-wave").is_visible())
    pg.click('#chat-listen [data-listen="done"]')
    pg.wait_for_timeout(1500)
    after = json.loads(_u.urlopen(ACCOUNT_SERVER + "/last").read())
    body = pg.evaluate("() => document.body.innerText")
    check("dictation: silence is not sent to be written down", before == after, (before.get("bytes"), after.get("bytes")))
    check("dictation: silence says Lune didn’t catch that, and the box stays empty", "Lune didn’t catch that" in body and pg.input_value("#chat-input") == "")
    # voice chat over silence says so too
    pg.click("#chat-talk")
    pg.wait_for_selector("#lune-talk[open]")
    pg.wait_for_function("() => /didn’t catch that/.test(document.getElementById('lt-caption').textContent)", timeout=60000)
    check("voice chat: silence is answered with “Lune didn’t catch that.”", True)
    check("voice chat: two round controls, the microphone and End", pg.locator("#lune-talk .lt-round").count() == 2)
    pg.click('#lune-talk [data-talk="end"]')
    check("voice: no page errors", not pg.errors, pg.errors)
    ctx.close()
    # + adds a tab on a computer as well as on a phone
    for width in (1280, 390):
        pg = new_page(browser, width=width, height=844)
        open_piece(pg)
        sel = ".piece-tab-new" if width > 900 else "#st-add"
        check(f"tabs ({width}px): + for a new tab is on screen with one piece open", pg.locator(sel).first.is_visible())
        pg.locator(sel).first.click()
        pg.wait_for_timeout(500)
        check(f"tabs ({width}px): + opens search, ready to type", pg.locator("#q").is_visible() and pg.evaluate("() => document.activeElement.id") == "q")
        pg.fill("#q", "clair de lune")
        pg.wait_for_timeout(1200)
        pg.locator("#results button, #results a, #results li").first.click()
        pg.wait_for_function("() => state.sessions.length === 2 && state.piece", timeout=60000)
        pg.wait_for_timeout(1500)
        tabs = pg.eval_on_selector_all("#piece-tabs .piece-tab-label", "els => els.map(e => e.textContent)")
        check(f"tabs ({width}px): the piece opens in a second tab, the first kept", len(tabs) == 2 and tabs[0] == "Für Elise" and pg.locator("#piece-tabs").is_visible(), tabs)
        check(f"tabs ({width}px): no page errors", not pg.errors, pg.errors)
        pg.context.close()
    # Ollama: Lune lists the models on this computer, including OpenAI's open model
    pg = new_page(browser, width=390, height=844)
    pg.route("http://localhost:11434/api/tags", lambda r: r.fulfill(status=200, content_type="application/json", headers={"Access-Control-Allow-Origin": "*"},
             body=json.dumps({"models": [{"name": "llama3.2:latest"}, {"name": "gpt-oss:20b"}]})))
    open_piece(pg)
    pg.evaluate("() => document.getElementById('btn-settings').click()")
    pg.wait_for_timeout(600)
    pg.evaluate("() => { document.querySelector('.settings-advanced').open = true; }")
    pg.click('[data-ai="ollama"]')
    pg.wait_for_selector('[data-ai="pick"]', timeout=8000)
    picks = pg.eval_on_selector_all('[data-ai="pick"]', "els => els.map(e => e.textContent)")
    check("ollama: Find Ollama lists the models on this computer, gpt-oss named as OpenAI's open model", picks == ["llama3.2:latest · Meta", "gpt-oss:20b · OpenAI open model"], picks)
    pg.click('[data-ai="pick"][data-model="gpt-oss:20b"]')
    got = pg.evaluate("() => [localStorage.getItem('lune.ai.endpoint'), localStorage.getItem('lune.ai.model')]")
    check("ollama: tapping one connects Ask Lune to it", got == ["http://localhost:11434/v1/chat/completions", "gpt-oss:20b"], got)
    check("ollama: no page errors", not pg.errors, pg.errors)
    pg.context.close()


def section_aipage(browser):
    """Lune AI has its own page (#/ai) with chat history, like ChatGPT."""
    for width in (1280, 390):
        ctx = browser.new_context(viewport={"width": width, "height": 844}, is_mobile=width < 600, has_touch=width < 600)
        ctx.add_init_script(POINT_AT_SERVER)
        pg = ctx.new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
        open_piece(pg)
        pg.evaluate(SIGN_IN)
        pg.evaluate("() => { localStorage.removeItem('lune.chats.v2'); localStorage.setItem('lune.chat.v1', JSON.stringify([{who:'you', text:'An older question about scales', t: 1}, {who:'lune', text:'Older answer', via:'model', t: 2}])); location.hash = '#/ai'; }")
        pg.wait_for_selector("#lune-chat[open].is-page #chat-form", timeout=10000)
        pg.wait_for_timeout(600)  # the opening animation
        check(f"ai page ({width}px): #/ai opens Lune AI full screen", pg.evaluate("() => { const r = document.getElementById('lune-chat').getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }"))
        if width < 900:
            pg.click("#chat-hist-btn")
        check(f"ai page ({width}px): the earlier chat is kept in history", "An older question about scales" in pg.inner_text("#chat-hist-list"))
        pg.click("[data-chat-new]")
        pg.fill("#chat-input", "How do I practise octaves?")
        pg.press("#chat-input", "Enter")
        pg.wait_for_function("() => document.querySelectorAll('#chat-log .chat-from-lune').length >= 1 && !document.querySelector('.chat-wait')", timeout=15000)
        pg.wait_for_timeout(1200)
        st = pg.evaluate("() => LuneAsk.chatStore()")
        titles = [c["title"] for c in st["convs"]]
        check(f"ai page ({width}px): a new chat is added to history, newest first, titled by its question", titles[:2] == ["How do I practise octaves?", "An older question about scales"], titles)
        if width < 900:
            pg.click("#chat-hist-btn")
        pg.click("#chat-hist-list [data-conv]:has-text('An older question')")
        pg.wait_for_timeout(300)
        check(f"ai page ({width}px): tapping a past chat brings it back", "Older answer" in pg.inner_text("#chat-log"))
        if width < 900:
            pg.click("#chat-hist-btn")
        pg.click("#chat-hist-list .ch-item:has-text('An older question') .ch-del")
        pg.wait_for_timeout(200)
        check(f"ai page ({width}px): a chat can be deleted", [c["title"] for c in pg.evaluate("() => LuneAsk.chatStore()")["convs"]] == ["How do I practise octaves?"])
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(800)
        check(f"ai page ({width}px): closing it leaves the #/ai address", pg.evaluate("() => location.hash") != "#/ai")
        check(f"ai page ({width}px): no page errors", not pg.errors, pg.errors)
        ctx.close()


def section_fixes(browser):
    """Restored tabs play; + opens on the score; Lune AI is one tap from Home and Repertoire and Back returns."""
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True)
    ctx.add_init_script(POINT_AT_SERVER)
    pg = ctx.new_page()
    pg.errors = []
    pg.on("pageerror", lambda e: pg.errors.append(str(e)[:200]))
    open_piece(pg)
    # + from the score opens the new piece on its score
    pg.click("#st-add")
    pg.wait_for_timeout(400)
    pg.fill("#q", "gymnopedie")
    pg.wait_for_timeout(1200)
    pg.locator("#results button, #results a, #results li").first.click()
    pg.wait_for_function("() => state.sessions.length === 2", timeout=60000)
    pg.wait_for_timeout(4000)
    check("tabs: a piece opened with + from the score opens on its score", pg.evaluate("() => state.panel") == "score" and "/score" in pg.evaluate("() => location.hash"))
    # a tab restored from the last visit plays
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(4000)
    lazy = pg.evaluate("() => state.sessions.some(s => s.lazy)")
    other = pg.evaluate("() => state.sessions.findIndex(s => s.id !== state.activeSessionId)")
    pg.locator("#piece-tabs .piece-tab-label").nth(other).click()
    pg.wait_for_timeout(6000)
    pg.click("#st-play")
    pg.wait_for_timeout(3000)
    check("tabs: a tab restored from the last visit plays when switched to", lazy and pg.get_attribute("#st-play", "aria-label") == "Pause", (lazy, pg.get_attribute("#st-play", "aria-label")))
    pg.click("#st-play")
    # Lune AI from Home: the Ask bar
    pg.evaluate(SIGN_IN)
    back = pg.evaluate("() => location.hash")
    pg.evaluate("() => { document.body.classList.add('is-signed-in'); document.getElementById('btn-home').click(); }")
    pg.wait_for_timeout(1200)
    check("home: Lune AI's Ask bar comes first on the signed-in home", pg.locator("#home-ask").is_visible())
    pg.fill("#home-ask-input", "How do I practise octaves?")
    pg.press("#home-ask-input", "Enter")
    pg.wait_for_function("() => document.querySelectorAll('#chat-log .chat-from-lune').length >= 1 && !document.querySelector('.chat-wait')", timeout=15000)
    check("home: a question there opens the Lune AI page and is answered", pg.evaluate("() => location.hash") == "#/ai" and "How do I practise octaves?" in pg.inner_text("#chat-log"))
    pg.click("#chat-close")
    pg.wait_for_timeout(600)
    check("ai page: closing it puts the address back where it was", pg.evaluate("() => location.hash") != "#/ai")
    # Repertoire: Ask Lune about a piece
    pg.evaluate("async () => { await LuneStore.addPiece({ piece_key: LunePractice.keyFor(state.piece), title: 'Für Elise', composer: 'Beethoven' }); await LunePractice.showRepertoire(); }")
    pg.wait_for_timeout(1000)
    pg.locator("#repertoire [data-ask-piece]").first.click()
    pg.wait_for_function("() => /How should I practise/.test(document.getElementById('chat-log')?.innerText || '')", timeout=15000)
    check("repertoire: Ask Lune on a piece asks about that piece on the Lune AI page", "How should I practise" in pg.inner_text("#chat-log"))
    # voice replies: one tap, and every answer is read aloud
    pg.evaluate("() => { window.__spoken = []; LunePractice.speak = (t) => window.__spoken.push(t); localStorage.removeItem('lune.voiceReplies'); }")
    pg.click("#chat-voice")
    check("voice replies: the speaker in the header turns them on", pg.get_attribute("#chat-voice", "aria-pressed") == "true")
    pg.fill("#chat-input", "What is a trill?")
    pg.press("#chat-input", "Enter")
    pg.wait_for_function("() => window.__spoken.length > 0", timeout=15000)
    check("voice replies: Lune's answer is read aloud", "STANDIN" in pg.evaluate("() => window.__spoken[0]"))
    pg.click("#chat-voice")
    check("voice replies: and off again", pg.get_attribute("#chat-voice", "aria-pressed") == "false")
    check("fixes: no page errors", not pg.errors, pg.errors)
    ctx.close()


def section_timing(browser):
    """Tempo changes written inside a bar start where they are written, so no bar stalls (Clair de lune's rubato)."""
    pg = new_page(browser)
    open_piece(pg, BASE + "#/claude-debussy-suite-bergamasque-clair-de-lune/score")
    pg.wait_for_timeout(1500)
    marks = pg.evaluate("() => LunePiano.barMarkers().slice(0, 80).map(x => x.t)")
    lens = [round(b - a, 3) for a, b in zip(marks, marks[1:])]
    worst = max((lens[i] / min(lens[i - 1], lens[i + 1]), i + 1) for i in range(1, len(lens) - 1))
    check("timing: no bar of Clair de lune lasts more than twice its neighbours", worst[0] < 2, (worst, lens[20:30]))
    check("timing: bar 26 keeps its ritardando without stalling (under 6 s)", 3 < lens[25] < 6, lens[25])
    check("timing: no page errors", not pg.errors, pg.errors)
    pg.context.close()


SECTIONS = {"ai": section_ai, "install": section_install, "tabs": section_tabs, "a11y": section_a11y, "ratings": section_ratings, "week": section_week, "catalogue": section_catalogue, "console": section_console, "account": section_account, "latest": section_latest, "voice": section_voice, "progress": section_progress, "home": section_home, "loop": section_practice_loop, "studio": section_studio, "plans": section_plans, "voice2": section_voice2, "aipage": section_aipage, "fixes": section_fixes, "timing": section_timing}

if __name__ == "__main__":
    want = sys.argv[1:] or list(SECTIONS)
    with sync_playwright() as p:
        PW = p
        browser = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"])  # headless has no speakers to unlock
        for name in want:
            try:
                SECTIONS[name](browser)
            except Exception as e:  # a crashed section is a failure, not a stop
                import traceback; traceback.print_exc()
                check(f"{name}: section ran", False, repr(e))
        browser.close()
    for status, name, detail in out:
        print(f"{status}  {name}" + (f"  ({detail})" if status == "FAIL" and detail else ""))
    passed = sum(1 for s, _, _ in out if s == "PASS")
    print(f"\n{passed}/{len(out)} passed")
    sys.exit(0 if passed == len(out) else 1)
