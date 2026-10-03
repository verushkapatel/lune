"""End-to-end flows for Lune's static site, run in a real browser.

Serve the built site under /lune/ (scripts/sync_pages_dev.sh, then a static
server whose /lune/ is pages-site), then:

    .venv/bin/python scripts/lune_flow_test.py [base-url]

Speech recognition and the language model are replaced by stand-ins (a fake
recogniser that "hears" a fixed phrase, and a local server that speaks the
OpenAI chat protocol), so those flows test Lune's handling, not the engines.
"""
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/lune/"
results = []


def check(name, cond, detail=""):
    results.append(bool(cond))
    print(("PASS  " if cond else "FAIL  ") + name + (f"   [{detail}]" if detail and not cond else ""), flush=True)


class Model(BaseHTTPRequestHandler):
    seen = []

    def log_message(self, *a):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Model.seen.append(body)
        if self.path == "/broken":
            self.send_response(500)
            self._cors()
            self.end_headers()
            return
        out = json.dumps({"choices": [{"message": {"content": "STAND-IN MODEL: answer built from the supplied context."}}]}).encode()
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(out)


server = HTTPServer(("127.0.0.1", 8791), Model)
threading.Thread(target=server.serve_forever, daemon=True).start()

FAKE_SPEECH = """
window.SpeechRecognition = class {
  start() { setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'why is this bar hard' }], { isFinal: true })] }); this.onend && this.onend(); }, 150); }
  stop() {} abort() {}
};
"""

with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
    cx = b.new_context(service_workers="block", viewport={"width": 1280, "height": 820})
    cx.grant_permissions(["clipboard-read", "clipboard-write"])
    cx.add_init_script(FAKE_SPEECH)
    pg = cx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    failed = []
    pg.on("response", lambda r: failed.append(r.url) if r.status >= 400 and "127.0.0.1:8137" in r.url else None)

    def ask(q):
        n = pg.evaluate("document.querySelectorAll('#ask-log .ask-from-lune').length")
        pg.fill("#ask-input", q)
        pg.click(".ask-send")
        pg.wait_for_function(f"(() => {{ const m = [...document.querySelectorAll('#ask-log .ask-from-lune')]; return m.length > {n} && !/Thinking/.test(m[m.length-1].textContent); }})()", timeout=15000)
        return pg.evaluate("[...document.querySelectorAll('#ask-log .ask-from-lune')].map(x => x.textContent).slice(%d).join(' | ')" % n)

    # FLOW 1 — home begins at the top
    pg.goto(BASE, wait_until="networkidle")
    check("1  home opens at the top", pg.evaluate("document.getElementById('home').scrollTop") == 0)

    # sign in on this device so search and Repertoire are available
    pg.evaluate("() => { LuneStore.completeLocalSignIn('tester@lune.test'); ['onboarded','seenWelcome','seenSignedWelcome'].forEach(k => LuneStore.setPref(k, true)); }")
    pg.reload(wait_until="networkidle")
    pg.evaluate("() => { document.querySelector('#hello:not([hidden]) button')?.click(); }")
    pg.wait_for_timeout(600)
    check("1  home is at the top after the welcome screen", pg.evaluate("document.getElementById('home').scrollTop") == 0)

    # FLOW 2 — search opens in a tab and the box clears
    pg.fill("#q", "fur elise")
    pg.press("#q", "Enter")
    pg.wait_for_function("!document.getElementById('studio').hidden", timeout=30000)
    check("2  search opens the piece", "Elise" in pg.evaluate("state.piece.title"))
    check("2  search box is cleared", pg.evaluate("document.getElementById('q').value") == "")
    pg.evaluate("() => { goHome({ forceApp: true }); }")
    pg.wait_for_timeout(500)
    pg.fill("#q", "clair de lune")
    pg.press("#q", "Enter")
    pg.wait_for_function("state.sessions.length === 2 && !document.getElementById('studio').hidden", timeout=30000)
    check("2  a second search opens a second tab", pg.evaluate("document.querySelectorAll('#piece-tabs .piece-tab').length") == 2)
    check("2  the current tab is marked", pg.evaluate("document.querySelectorAll('#piece-tabs .piece-tab.on').length") == 1)
    check("2  a new-tab button is there", pg.is_visible("#piece-tabs .piece-tab-new"))

    # FLOW 3 — add to repertoire, in words, once
    pg.click(".studio-tab[data-panel=score]")
    pg.wait_for_selector("#osmd g.vf-notehead", timeout=40000)
    check("3  button says what it does", "Add this piece to my Repertoire" in pg.evaluate("document.querySelector('#btn-bookmark .lp-add-label').textContent"))
    pg.click("#btn-bookmark")
    pg.wait_for_function("/in your Repertoire/.test(document.querySelector('#btn-bookmark .lp-add-label').textContent)", timeout=8000)
    pg.evaluate("async () => { await LunePractice.addCurrentToRepertoire({ quiet: true }); }")
    key = pg.evaluate("LunePractice.keyFor(state.piece)")
    check("3  piece is in the Repertoire exactly once", pg.evaluate("LuneStore.listPieces().then(ps => ps.filter(p => p.piece_key === '%s').length)" % key) == 1)

    # FLOW 5 — show piano without leaving the score
    pg.click("#btn-toggle-kbd")
    pg.wait_for_timeout(400)
    check("5  piano shows and the score stays", pg.evaluate("!document.getElementById('piano-dock').hidden && state.panel === 'score' && document.querySelectorAll('#osmd g.vf-notehead').length > 100"))
    pg.click("#btn-toggle-kbd")

    # FLOW 6 — the event pipeline: pitches, onsets, ties, sustain, one timeline for sound and keys
    r = pg.evaluate("""async () => {
      document.getElementById('btn-play-range').click(); await new Promise(r => setTimeout(r, 3500));
      const ev = LunePiano.eventsRef(); const marks = LunePiano.barMarkers();
      const xml = new DOMParser().parseFromString(state.piece.musicxml, 'application/xml');
      const tempo = Number(xml.querySelector('sound[tempo]')?.getAttribute('tempo'));
      const m1 = xml.querySelector('measure'); const div = Number(xml.querySelector('divisions').textContent);
      // written length of bar 1 in crotchets, from the first voice
      let q = 0; for (const el of m1.children) { if (el.nodeName === 'backup') break; if (el.nodeName === 'note' && !el.querySelector('chord') && !el.querySelector('grace')) q += Number(el.querySelector('duration').textContent) / div; }
      const bar2 = marks.find(m => m.bar === 2);
      const firstPitched = [...m1.querySelectorAll('note')].filter(n => n.querySelector('pitch') && n.getAttribute('print-object') !== 'no')[0];
      const STEP = {C:0,D:2,E:4,F:5,G:7,A:9,B:11}; const pp = firstPitched.querySelector('pitch');
      const midi = (Number(pp.querySelector('octave').textContent) + 1) * 12 + STEP[pp.querySelector('step').textContent] + Number(pp.querySelector('alter')?.textContent || 0);
      const at = LunePiano.progress(); const sounding = ev.filter(e => e.t <= at && e.t + e.dur > at).map(e => e.midi).sort().join(',');
      const out = { tempo, expectBar2: q * 60 / tempo, gotBar2: bar2 && bar2.t, firstMidiInScore: midi, bar1HasIt: ev.some(e => e.bar === 1 && e.midi === midi),
        tiesHeld: tieIndex(state.piece).stops.size, restruck: ev.filter(e => tieIndex(state.piece).stops.has(`${e.bar}:${e.midi}:${Math.round(e.barOff * 1000)}`)).length,
        sustained: ev.filter(e => e.sound > e.dur + 0.05).length, sameTimeline: LunePiano.eventsRef() === LunePiano.eventsRef(), playing: LunePiano.isPlaying(), sounding };
      document.getElementById('btn-play-range').click(); return out; }""")
    check("6  tempo follows the score's marking", r["tempo"] > 0 and abs(r["gotBar2"] - r["expectBar2"]) < 0.02, str(r))
    check("6  the score's first note is in the timeline at its pitch", r["bar1HasIt"], str(r))
    check("6  tied notes are held, not struck again", r["tiesHeld"] > 0 and r["restruck"] == 0, str(r))
    check("6  the pedal lengthens notes", r["sustained"] > 0, str(r))
    check("6  it plays", r["playing"])
    pg.click(".studio-tab[data-panel=piano]")
    pg.wait_for_timeout(600)
    lit = pg.evaluate("(() => { const c = document.getElementById('piano-roll-canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 400) if (d[i] > 120) n++; return n; })()")
    check("6  the piano view draws from that same timeline", lit > 50)
    pg.click(".studio-tab[data-panel=score]")
    pg.wait_for_selector("#osmd g.vf-notehead", timeout=40000)

    # FLOW 7 — Notes / Fingers without a redraw
    r = pg.evaluate("""async () => { const svg = document.querySelector('#osmd svg'); const top = document.getElementById('score-scroll').scrollTop; const t = performance.now();
      document.getElementById('anno-fingers').click(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return { ms: performance.now() - t, sameSvg: svg === document.querySelector('#osmd svg'), sameScroll: top === document.getElementById('score-scroll').scrollTop, fingers: document.querySelectorAll('#osmd text.lane-finger').length }; }""")
    check("7  Fingers appears in under 150 ms with no re-engraving or scroll jump", r["ms"] < 150 and r["sameSvg"] and r["sameScroll"] and r["fingers"] > 50, str(r))
    pg.evaluate("() => { document.getElementById('anno-notes').click(); }")

    # FLOW 8 — a remark is saved, flagged and shown
    pg.evaluate("() => { setBarSelection([3], { open: true }); }")
    pg.wait_for_selector("#lp-note-input")
    pg.fill("#lp-note-input", "Keep the thumb light <b>here</b>")
    pg.click(".lp-save")
    pg.wait_for_function("document.querySelectorAll('.lp-notes .lp-note').length > 0", timeout=8000)
    check("8  remark shows in the bar panel under Remarks", "Remarks" in pg.inner_text(".lp-coach") or "REMARKS" in pg.inner_text(".lp-coach"))
    check("8  remark text is shown as text, never as HTML", pg.evaluate("!document.querySelector('.lp-notes b') && /<b>here<\\/b>/.test(document.querySelector('.lp-notes .lp-note p').textContent)"))
    check("8  the bar carries a marker on the score", pg.evaluate("document.querySelectorAll('.lp-mark, .lp-note-mark, [data-lp-mark]').length") > 0 or pg.evaluate("document.querySelector('#score-scroll').innerHTML.includes('lp-')"))

    # FLOW 9 — Ask Lune, typed, in context (built in)
    pg.click("#btn-tell")
    pg.wait_for_selector("#ask-lune:not([hidden])")
    check("9  Ask Lune knows the bar it was opened on", "bar 3" in pg.inner_text("#ask-where"))
    a = ask("What is the fingering?")
    check("9  typed question gets an answer from the score", "hand" in a.lower(), a)
    check("9  it says the local model is not connected and that these are built-in answers", "Local model not connected" in pg.inner_text("#ask-fine") and "built-in" in pg.inner_text("#ask-fine") and "Nothing is sent" in pg.inner_text("#ask-fine"))
    check("AI with no model, the provider returns nothing instead of pretending", pg.evaluate("LuneAIProvider.connected() === false") and pg.evaluate("LuneAIProvider.explainBar(3)") is None)

    # FLOW 10 — spoken question: transcript, edit, send
    pg.click("#ask-mic")
    pg.wait_for_function("document.getElementById('ask-input').value.length > 0", timeout=8000)
    heard = pg.evaluate("document.getElementById('ask-input').value")
    check("10 speech lands in the box, punctuated, not yet sent", heard == "Why is this bar hard?", heard)
    pg.fill("#ask-input", "Why is this bar hard for me?")
    n = pg.evaluate("document.querySelectorAll('#ask-log .ask-from-you').length")
    pg.click(".ask-send")
    pg.wait_for_function(f"document.querySelectorAll('#ask-log .ask-from-you').length > {n}")
    check("10 the edited words are what gets sent", "for me" in pg.evaluate("[...document.querySelectorAll('#ask-log .ask-from-you')].pop().textContent"))

    # AI provider: a connected model gets system prompt + structured context; failure falls back
    pg.evaluate("() => { localStorage.setItem('lune.ai.endpoint', 'http://127.0.0.1:8791/chat'); localStorage.setItem('lune.ai.model', 'stand-in'); }")
    pg.click("#ask-close"); pg.click("#btn-tell")
    a = ask("How should I practise this bar?")
    sent = Model.seen[-1] if Model.seen else {}
    ctx = sent.get("messages", [{}, {}])[1].get("content", "") if sent else ""
    check("AI the connected model's answer is shown", "STAND-IN MODEL" in a, a)
    check("AI the panel names the connected model", "Local model connected (stand-in)" in pg.inner_text("#ask-fine"))
    check("AI named capabilities reach the model with a task instruction", "STAND-IN" in (pg.evaluate("LuneAIProvider.explainFingering(3)") or "") and "fingering" in Model.seen[-1]["messages"][1]["content"])
    check("AI context includes neighbouring bars and the practising tempo", '"neighbouringBars"' in ctx and '"tempo"' in ctx, ctx[:200])
    check("AI the request carries the system prompt, the model name and no key", sent.get("model") == "stand-in" and "Never invent" in sent["messages"][0]["content"] and "authorization" not in json.dumps(sent).lower())
    check("AI the context holds this bar's notes, the remark, the goal and earlier questions", all(k in ctx for k in ('"bar"', '"rightHand"', "thumb light", '"goal"', '"earlierQuestions"')), ctx[:300])
    pg.evaluate("() => { localStorage.setItem('lune.ai.endpoint', 'http://127.0.0.1:8791/broken'); }")
    a = ask("How should I practise this bar?")
    check("AI if the model fails, the built-in answer is shown and says so", "built-in reply" in a and "STAND-IN" not in a, a)
    pg.evaluate("() => { localStorage.removeItem('lune.ai.endpoint'); localStorage.removeItem('lune.ai.model'); }")

    # FLOW 11 + 12 — plan and "how did it go", then persistence across a reload
    a = ask("that was hard")
    check("12 how it went is saved to practice history", "Logged bar" in a, a)
    a = ask("Make a plan")
    check("11 a plan is made from the bar, the remark and the history", "Plan saved" in a and "thumb light" in a, a)
    pg.click("#ask-close")
    pg.reload(wait_until="networkidle")
    pg.wait_for_timeout(800)
    st = pg.evaluate("""async () => { const k = '%s'; const t = LuneStore.listTasks().filter(x => x.piece_key === k); const c = await LuneStore.listCards(k); const n = await LuneStore.listNotes(k);
      return { tasks: t.length, bars: t[0] && t[0].bars, steps: t[0] && t[0].plan.steps.length, grade: (c.find(x => x.bar === 3) || {}).last_grade, notes: n.length, theme: 1 }; }""" % key)
    check("11 the plan survives a reload with its bars and steps", st["tasks"] >= 1 and 3 in (st["bars"] or []) and st["steps"] >= 3, str(st))
    check("12 the rating and the remark survive a reload", st["grade"] == "hard" and st["notes"] >= 1, str(st))

    # FLOW 4 — Repertoire: level, work on this piece, add a task of your own
    pg.evaluate("() => { document.querySelector('#hello:not([hidden]) button')?.click(); LunePractice.showRepertoire(); }")
    pg.wait_for_selector("#rep-list .rep-card", timeout=10000)
    card = pg.inner_text("#rep-list")
    check("4  level is shown and called Lune's estimate", "Level:" in card and "estimate" in card, card[:200])
    check("4  tasks say who wrote them", "SUGGESTED BY LUNE" in pg.inner_text("#rep-today").upper())
    pg.click(f'#rep-list [data-work="{key}"]')
    pg.wait_for_selector("#work-dialog .work-steps", timeout=20000)
    work = pg.inner_text("#work-dialog")
    check("4  Work on this piece lists bars, the remark and the review that is due", "Bar 3" in work and "thumb light" in work, work[:300])
    pg.fill("#work-extra", "Memorise the first page")
    pg.click("[data-work-add]")
    pg.wait_for_timeout(500)
    check("4  my own line is added to the plan", pg.evaluate("LuneStore.listTasks().some(t => /Memorise the first page/.test(JSON.stringify(t)))"))

    # FLOW 16-19 — sharing explains what is shared, then Share / Copy / Cancel
    pg.click("#rep-share")
    pg.wait_for_selector("#share-preview-dialog[open]")
    prev = pg.evaluate("document.getElementById('share-preview-text').value")
    check("16 share repertoire shows exactly what will be shared", "What will be shared".upper() in pg.inner_text("#share-preview-dialog").upper() and "Clair de lune" in prev)
    check("16 the share text has no email, ids or remark text", "tester@" not in prev and key not in prev and "thumb light" not in prev)
    pg.click("[data-sp=copy]")
    pg.wait_for_timeout(300)
    check("16 Copy puts that text on the clipboard", "Clair de lune" in pg.evaluate("navigator.clipboard.readText()"))
    pg.evaluate("() => { LunePractice.openFromRepertoire('%s'); }" % key)
    pg.wait_for_selector("#osmd g.vf-notehead", timeout=40000)
    pg.click(".studio-tab[data-panel=explain]")
    pg.wait_for_timeout(500)
    pg.click("#btn-share-piece")
    pg.wait_for_selector("#share-preview-dialog[open]")
    prev = pg.evaluate("document.getElementById('share-preview-text').value")
    check("17 share piece progress previews status, review bars and remarks", "Where it stands" in prev and "Bar 3" in prev)
    pg.click("[data-sp=cancel]")
    check("17 Cancel closes without sharing", pg.evaluate("!document.getElementById('share-preview-dialog').open"))
    pg.click("#btn-share")
    pg.wait_for_selector("#share-dialog[open]")
    sh = pg.inner_text("#share-dialog")
    check("18 share week is offered with an explanation", "This week" in sh and "read-only" in sh)
    check("19 share annotated bars is offered with an explanation", "Annotated bars" in sh)
    pg.evaluate("() => document.getElementById('share-dialog').close()")

    # FLOW 13 — braille from the Overview
    pg.goto(BASE + "#/ludwig-van-beethoven-fur-elise/explain", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    href = pg.evaluate("document.getElementById('btn-braille-explain').href")
    body = pg.request.get(href).text() if href.endswith(".brf") else ""
    check("13 braille is offered on the Overview and downloads real braille", pg.is_visible("#btn-braille-explain") and len(body) > 500 and all(len(l) <= 40 for l in body.splitlines()[:60]))
    pg.goto(BASE + "#/debussy-clair-de-lune/explain", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    check("13 a piece without braille says so instead of showing an empty link", pg.is_visible("#braille-none-explain") and not pg.is_visible("#btn-braille-explain"))

    # FLOW 15 — example week, isolated from real data
    before = pg.evaluate("JSON.stringify([LuneStore.listTasks().length, LuneStore.prefs().weekRollups || null])")
    pg.click("#btn-settings")
    pg.click("[data-set=example-week]")
    seen = []
    for _ in range(7):
        seen.append(pg.inner_text("#example-week-dialog"))
        pg.click("[data-ex=next]")
    check("15 seven steps, every one marked as an example", len(seen) == 7 and all("EXAMPLE" in s.upper() and "Nothing here is saved" in s for s in seen))
    check("15 real data is untouched by the example", before == pg.evaluate("JSON.stringify([LuneStore.listTasks().length, LuneStore.prefs().weekRollups || null])"))

    # FLOW 20 / 21 — light and dark
    pg.click("#btn-settings")
    pg.click("[data-theme-set=light]")
    lum = "(() => { const m = getComputedStyle(document.body).backgroundColor.match(/[\\d.]+/g).map(Number); return (m[0] + m[1] + m[2]) / 3; })()"
    check("20 light mode: real light colours (no page filter), remembered", pg.evaluate("document.documentElement.dataset.theme === 'light' && localStorage.getItem('lune.theme') === 'light' && getComputedStyle(document.documentElement).filter === 'none'") and pg.evaluate(lum) > 230)
    check("20 light mode: the score page is white paper", pg.evaluate("getComputedStyle(document.querySelector('.score-page')).filter") == "none")
    pg.click("[data-theme-set=dark]")
    check("21 dark mode: dark shell and a dark score page", pg.evaluate("!document.documentElement.dataset.theme") and pg.evaluate(lum) < 30 and "invert" in pg.evaluate("getComputedStyle(document.querySelector('.score-page')).filter"))
    sett = pg.inner_text("#settings-dialog").upper()
    check("19 Settings has Appearance, Reading and access, Your week, Ask Lune, Privacy, About", all(s in sett for s in ("APPEARANCE", "READING AND ACCESS", "YOUR WEEK", "ASK LUNE", "PRIVACY", "ABOUT LUNE")))
    check("25 Privacy says what Ask Lune sends", "nothing you ask is sent anywhere" in pg.inner_text("#settings-dialog"))
    pg.evaluate("() => document.getElementById('settings-dialog').close()")

    # FLOW 22 — install metadata
    man = pg.request.get(BASE + "manifest.webmanifest").json()
    check("22 manifest: name, standalone, 192 and 512 icons, maskable", man["display"] == "standalone" and {"192x192", "512x512"} <= {i["sizes"] for i in man["icons"]} and any(i.get("purpose") == "maskable" for i in man["icons"]))
    check("22 service worker file is served at the site root", pg.request.get(BASE + "sw.js").ok)

    # FLOW 23 — feedback validation and states
    pg.goto(BASE + "#feedback", wait_until="networkidle")
    pg.wait_for_selector("#feedback-dialog[open]", timeout=8000)
    pg.click("#feedback-form button[type=submit]")
    check("23 empty feedback is refused with a message", "Write a sentence" in pg.inner_text("#feedback-msg"))
    pg.route("**/formsubmit.co/**", lambda r: r.fulfill(status=200, content_type="application/json", body='{"success":"true"}'))
    pg.fill("#fb-changed", "TEST")
    pg.click("#feedback-form button[type=submit]")
    pg.wait_for_selector(".feedback-thanks", timeout=8000)
    check("23 success state after sending", "Thank you" in pg.inner_text("#feedback-dialog"))
    pg.click("#feedback-dialog [data-fb-cancel]")

    # FLOW 14 — accessibility question in setup (fresh visitor)
    pg2 = b.new_context(service_workers="block", viewport={"width": 390, "height": 844}).new_page()
    pg2.goto(BASE, wait_until="networkidle")
    pg2.evaluate("() => { LuneOnboard.showOnboard(3); }")
    pg2.wait_for_selector("[data-need=vision]")
    txt = pg2.inner_text(".onboard-needs")
    check("14 one question with Visual, Dyslexia and Neither", "do you need accessibility support" in txt.lower() and "neither" in txt.lower() and "visual" in txt.lower() and "dyslexia" in txt.lower())
    pg2.click("[data-need=dyslexia]")
    check("14 dyslexia switches on easy read letters only", pg2.evaluate("(p => p.readableFont && !p.largePrint)(LuneStore.prefs())"))
    pg2.click("[data-need=vision]")
    check("14 visual switches on large print, contrast and spoken bars", pg2.evaluate("(p => p.largePrint && p.highContrast && p.autoRead)(LuneStore.prefs())"))
    pg2.click("[data-need=none]")
    check("14 Neither switches everything off", pg2.evaluate("(p => !p.readableFont && !p.largePrint && !p.autoRead)(LuneStore.prefs())"))
    pg2.keyboard.press("Tab")
    check("14 the options are real buttons reachable by keyboard", pg2.evaluate("[...document.querySelectorAll('[data-need]')].every(b => b.tagName === 'BUTTON' && b.hasAttribute('aria-pressed'))"))
    check("30 phone: no sideways scroll on setup", pg2.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))

    # reading aloud controls
    pg.goto(BASE + "#/debussy-clair-de-lune/score", wait_until="networkidle")
    pg.wait_for_selector("#osmd g.vf-notehead", timeout=40000)
    pg.evaluate("() => { setBarSelection([2], { open: false }); }")
    pg.click("#btn-listen")
    pg.wait_for_timeout(400)
    check("11b Listen shows Pause, Replay and Stop", pg.evaluate("(() => { const b = document.getElementById('listen-bar'); return !!b && ['pause','replay','stop'].every(k => b.querySelector(`[data-listen=${k}]`)); })()"))
    pg.evaluate("() => { document.querySelector('#listen-bar [data-listen=stop]')?.click(); }")

    # MUSIC — the event timeline against the written score, on different kinds of piece
    MUSIC = """async () => {
      const ev = LunePiano.eventsRef(); const marks = LunePiano.barMarkers(); const xml = new DOMParser().parseFromString(state.piece.musicxml, 'application/xml');
      const STEP = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
      const part = xml.querySelector('part'); const measures = [...part.children].filter(m => m.nodeName === 'measure');
      let div = 1, wrongPitch = 0, checked = 0;
      for (const m of measures.slice(0, 6)) {
        const d = m.querySelector('divisions'); if (d) div = Number(d.textContent);
        const bar = Number(m.getAttribute('number'));
        const written = new Set([...m.querySelectorAll('note')].filter(n => n.querySelector('pitch') && !n.querySelector('grace')).map(n => { const p = n.querySelector('pitch'); return (Number(p.querySelector('octave').textContent) + 1) * 12 + STEP[p.querySelector('step').textContent] + Math.round(Number(p.querySelector('alter')?.textContent || 0)); }));
        for (const e of ev.filter(e => e.bar === bar)) { checked++; if (!written.has(e.midi)) wrongPitch++; }
      }
      const idx = tieIndex(state.piece);
      const restruck = ev.filter(e => idx.stops.has(`${e.bar}:${e.midi}:${Math.round(e.barOff * 1000)}`)).length;
      const sorted = ev.every((e, i) => i === 0 || e.t >= ev[i - 1].t);
      const chords = ev.filter((e, i) => i > 0 && e.t === ev[i - 1].t).length;
      const tempo = Number(xml.querySelector('sound[tempo]')?.getAttribute('tempo')) || null;
      // bar lengths in seconds should match the written length at the marked tempo (first 4 full bars)
      let barErr = 0; const beats = Number(xml.querySelector('time beats')?.textContent), beatType = Number(xml.querySelector('time beat-type')?.textContent);
      if (tempo && beats && beatType) { const want = beats * 4 / beatType * 60 / tempo; for (let i = 1; i < Math.min(5, marks.length - 1); i++) barErr = Math.max(barErr, Math.abs((marks[i + 1].t - marks[i].t) - want)); }
      return { notes: ev.length, checked, wrongPitch, ties: idx.stops.size, restruck, sorted, chords, pedalMarks: idx.pedal.length, sustained: ev.filter(e => e.sound > e.dur + 0.05).length, minDur: Math.min(...ev.map(e => e.dur)), tempo, barErr: Math.round(barErr * 1000) / 1000, dyn: new Set(ev.map(e => Math.round(e.dyn * 10))).size };
    }"""
    for label, pid in (("slow, tied, pedalled (Clair de lune)", "debussy-clair-de-lune"), ("marked pedal (Für Elise)", "ludwig-van-beethoven-fur-elise"), ("no pedal, even semiquavers (Bach Prelude in C)", "bach-prelude-c"), ("polyphonic, fetched on open (Bach Fugue BWV 846)", "asap-bach-fugue-bwv-846"), ("fast and chord-heavy (Chopin Etude Op. 10 no. 12, fetched)", "asap-chopin-etudes-op-10-12")):
        pg.goto(BASE + f"#/{pid}/score", wait_until="networkidle")
        try:
            pg.wait_for_selector("#osmd g.vf-notehead", timeout=90000)
            pg.evaluate("() => { primeTimeline(); }")
            pg.wait_for_timeout(400)
            m = pg.evaluate(MUSIC)
            ok = m["notes"] > 100 and m["wrongPitch"] == 0 and m["restruck"] == 0 and m["sorted"] and m["minDur"] > 0 and (m["tempo"] is None or m["barErr"] < 0.03)
            check(f"MUSIC {label}: pitches from the score, onsets in order, ties held, bar lengths at the marked tempo", ok, str(m))
            print(f"        {m}", flush=True)
        except Exception as err:  # a piece that fails to open is a failure, not a skip
            check(f"MUSIC {label}: opens", False, str(err)[:120])

    # ACCESSIBILITY — names, labels, dialogs, headings, keyboard, reduced motion
    pg.goto(BASE + "#/debussy-clair-de-lune/score", wait_until="networkidle")
    pg.wait_for_selector("#osmd g.vf-notehead", timeout=40000)
    pg.evaluate("() => { setBarSelection([2], { open: true }); }")
    pg.wait_for_timeout(600)
    a11y = pg.evaluate("""() => {
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.closest('[hidden], [aria-hidden="true"]'); };
      const name = (e) => (e.getAttribute('aria-label') || e.textContent || e.title || '').trim() || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent) || '';
      const unnamed = [...document.querySelectorAll('button, a[href], [role=button]')].filter(vis).filter(e => !name(e)).map(e => e.id || e.className).slice(0, 5);
      const unlabelled = [...document.querySelectorAll('input:not([type=hidden]):not([type=file]), select, textarea')].filter(vis).filter(e => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label'))).map(e => e.id || e.name || e.className).slice(0, 5);
      const imgs = [...document.querySelectorAll('img')].filter(vis).filter(e => !e.hasAttribute('alt')).length;
      return { unnamed, unlabelled, imgs, lang: document.documentElement.lang, mains: document.querySelectorAll('main:not([hidden])').length };
    }""")
    check("A11Y every visible button and link has a name", not a11y["unnamed"], str(a11y["unnamed"]))
    check("A11Y every visible field has a label", not a11y["unlabelled"], str(a11y["unlabelled"]))
    check("A11Y images have alt text and the page declares its language", a11y["imgs"] == 0 and a11y["lang"] == "en")
    pg.evaluate("() => { clearBarSelection({ close: true }); document.getElementById('anno-notes').focus(); }")
    order = []
    for _ in range(14):
        pg.keyboard.press("Tab")
        order.append(pg.evaluate("(document.activeElement.id || document.activeElement.className || document.activeElement.tagName) + '|' + (getComputedStyle(document.activeElement).outlineStyle !== 'none' || getComputedStyle(document.activeElement).boxShadow !== 'none')"))
    check("A11Y Tab reaches the score controls with a visible focus ring", any("btn-tell" in o for o in order) and any("btn-toggle-kbd" in o for o in order) and any("btn-listen" in o for o in order) and all(o.endswith("true") for o in order if "is-studio" not in o), str(order))
    pg.click("#btn-settings")
    check("A11Y Settings is a modal dialog that Escape closes", pg.evaluate("document.getElementById('settings-dialog').matches(':modal')"))
    pg.keyboard.press("Escape")
    check("A11Y Escape closes it", pg.evaluate("!document.getElementById('settings-dialog').open"))
    rm = b.new_context(service_workers="block", viewport={"width": 390, "height": 844}, reduced_motion="reduce").new_page()
    rm.goto(BASE, wait_until="networkidle")
    rm.evaluate("() => { document.getElementById('feat-letters').scrollIntoView(); }")
    rm.wait_for_timeout(600)
    check("REDUCED MOTION landing sections are shown without waiting for a reveal animation", rm.evaluate("[...document.querySelectorAll('.home-for, .home-feedback')].every(e => getComputedStyle(e).opacity === '1')"))
    check("REDUCED MOTION the Ask Lune panel has no entry animation", rm.evaluate("(() => { const s = [...document.styleSheets].flatMap(sh => { try { return [...sh.cssRules]; } catch { return []; } }); return s.some(r => r.media && /reduced-motion/.test(r.media.mediaText) && /ask-lune/.test(r.cssText)); })()"))
    check("PHONE no sideways scroll on the landing page", rm.evaluate("document.getElementById('home').scrollWidth <= document.getElementById('home').clientWidth + 1"))
    rm.goto(BASE + "#/debussy-clair-de-lune/score", wait_until="networkidle")
    rm.wait_for_selector("#osmd g.vf-notehead", timeout=40000)
    check("PHONE the score's main controls are on screen", rm.evaluate("['btn-tell', 'btn-listen', 'btn-toggle-kbd', 'btn-play-range'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 1; })"))
    rm.click("#btn-tell")
    rm.wait_for_timeout(400)
    check("PHONE Ask Lune opens as a sheet that fits the screen", rm.evaluate("(() => { const r = document.getElementById('ask-lune').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1; })()"))

    check("no page errors in any flow", not errors, " | ".join(errors[:3]))
    check("no failed requests to the site", not failed, " | ".join(failed[:4]))
    b.close()

server.shutdown()
print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
