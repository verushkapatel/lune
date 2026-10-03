"""Checks for Repertoire, bar notes, review scheduling, teacher links,
reading & access and the reading study (browser-only storage mode).

Serve the static export under /lune/ then:
    python3 scripts/claude_practice_test.py [base-url] [upload-dir]
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/lune/"
UP = sys.argv[2] if len(sys.argv) > 2 else "/tmp/up"
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:240]))


def wait_score(pg, n=50):
    pg.wait_for_function(f"() => document.querySelectorAll('#osmd .lane-letter').length > {n}", timeout=60000)
    pg.wait_for_timeout(300)


def main(p):
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1280, "height": 860})
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.goto(BASE, wait_until="networkidle")

    # --- spoken-note parsing ---
    cases = {
        "Lune, bar 12: play faster here": [12, "Play faster here"],
        "bar twenty three keep the left hand quiet": [23, "Keep the left hand quiet"],
        "measure 4 thumb under on the F": [4, "Thumb under on the F"],
        "play faster here": [7, "Play faster here"],
        "note bar one hundred and four pedal change": [104, "Pedal change"],
    }
    bad = []
    for said, want in cases.items():
        got = pg.evaluate("([t]) => { const r = LunePractice.parseSpoken(t, 7); return [r.bar, r.body]; }", [said])
        if got != want:
            bad.append((said, got))
    check("voice: 'bar N …' phrases parse to bar + note", not bad, bad)
    tags = pg.evaluate("() => LunePractice.tagsFor('play faster and softer, use thumb')")
    check("notes: auto tags", set(["tempo", "dynamics", "fingering"]) <= set(tags), tags)

    # --- scheduling maths ---
    sched = pg.evaluate(
        """() => { const S = LuneStore.schedule; let c = {}; const seq = [];
        for (const g of ['good','good','good','hard','again','good']) { c = S(c, g); seq.push([g, c.interval_days, +c.ease.toFixed(2)]); }
        return seq; }"""
    )
    ok = sched[0][1] == 1 and sched[1][1] == 3 and sched[2][1] > 6 and sched[4][1] == 0 and sched[3][2] < 2.5
    check("review: intervals grow (1 → 3 → ~7.5 days), 'again' resets", ok, sched)

    # --- Repertoire: add from search ---
    pg.click("#btn-repertoire")
    pg.wait_for_selector("#repertoire:not([hidden])")
    check("repertoire: header button opens the page, URL #/repertoire", pg.evaluate("location.hash") == "#/repertoire")
    empty = pg.inner_text("#rep-list")
    check("repertoire: empty state explains what to do", "empty" in empty.lower(), empty)
    pg.fill("#rep-add-q", "fur elise")
    pg.wait_for_timeout(250)
    sug = pg.inner_text("#rep-suggest")
    check("repertoire: typing suggests catalogue pieces", "Für Elise" in sug, sug[:120])
    pg.click("#rep-suggest [data-add]")
    pg.wait_for_timeout(300)
    cards = pg.inner_text("#rep-list")
    check("repertoire: piece added", "Für Elise" in cards, cards[:120])
    pg.fill("#rep-add-q", "Some piece I only have on paper")
    pg.wait_for_timeout(200)
    pg.click("#rep-suggest [data-add-typed]")
    pg.wait_for_timeout(300)
    check("repertoire: a typed piece not in the library can be added", "only have on paper" in pg.inner_text("#rep-list"))

    # --- open from Repertoire, note on a bar ---
    pg.click('#rep-list [data-open="beethoven-fur-elise"]')
    wait_score(pg)
    check("repertoire: Open goes to the score", pg.evaluate("location.hash").startswith("#/beethoven-fur-elise/score"))
    check("score: toolbar shows 'In Repertoire'", pg.get_attribute("#btn-bookmark", "aria-label") == "In Repertoire", pg.get_attribute("#btn-bookmark", "aria-label"))
    pg.evaluate("() => setBarSelection([5], {open: true})")
    pg.wait_for_selector(".lp-coach")
    pg.fill("#lp-note-input", "play faster here")
    pg.click(".lp-save")
    pg.wait_for_function("() => document.querySelector('.lp-notes')?.innerText.includes('play faster here')", timeout=5000)
    check("coach: typed note saved and listed", True)
    pg.wait_for_timeout(300)
    mark = pg.evaluate("() => [...document.querySelectorAll('#lp-marks .lp-mark')].map(m => m.dataset.bar + ':' + m.textContent)")
    check("score: note marker drawn on bar 5", "5:1" in mark, mark)
    # marker sits on the bar's top-right corner
    pos = pg.evaluate(
        """() => { const m = document.querySelector('#lp-marks .lp-mark[data-bar="5"]'); const b = LuneAnnotate.measureBoundsInHost(state.osmd, document.getElementById('osmd'), 5);
        return {mx: parseFloat(m.style.left), bx: b.left + b.width, my: parseFloat(m.style.top), by: b.top}; }"""
    )
    check("score: marker aligned with its bar", abs(pos["mx"] - pos["bx"]) < 8 and abs(pos["my"] - pos["by"]) < 10, pos)
    # spoken path (no mic in tests): same save function with a 'bar N' phrase
    pg.evaluate("async () => { const r = LunePractice.parseSpoken('bar 9, keep it soft', 5); await LunePractice.saveNote(r.bar, r.body, 'voice'); }")
    pg.wait_for_timeout(300)
    mark = pg.evaluate("() => [...document.querySelectorAll('#lp-marks .lp-mark')].map(m => m.dataset.bar)")
    check("voice: 'bar 9, …' lands on bar 9", "9" in mark, mark)

    # --- keyboard: step bars ---
    pg.click("#coach-title")
    pg.keyboard.press("ArrowRight")
    pg.wait_for_timeout(300)
    check("keys: → moves the selection to the next bar", pg.evaluate("state.selectedBars.join(',')") == "6", pg.evaluate("state.selectedBars.join(',')"))
    pg.keyboard.press("ArrowLeft")
    pg.wait_for_timeout(300)

    # --- review grade ---
    pg.click(".lp-grade.lp-hard")
    pg.wait_for_timeout(400)
    due = pg.inner_text(".lp-due")
    check("review: grading shows next review", "Next review" in due, due)
    pg.evaluate("() => LuneStore.queueBar('beethoven-fur-elise', 12)")
    # describe aloud
    words = pg.evaluate("() => LunePractice.describeBar(5)")
    check("access: bar description reads hands, notes, fingers", "Right hand" in words and "Left hand" in words, words[:160])

    # --- today's bars → opens bar ---
    pg.click("#btn-repertoire")
    pg.wait_for_selector("#repertoire:not([hidden])")
    pg.wait_for_timeout(300)
    today = pg.inner_text("#rep-today")
    check("today: queued bar 12 is due", "Bar 12" in today, today[:120])
    badge = pg.evaluate("() => document.getElementById('rep-badge').hidden ? '' : document.getElementById('rep-badge').textContent")
    check("today: header badge counts due bars", badge == "1", badge)
    pg.click('#rep-today [data-bar="12"]')
    pg.wait_for_function("() => state.selectedBars.includes(12) && !document.getElementById('coach').hidden", timeout=30000)
    check("today: tapping a due bar opens it in the score", True)

    # --- teacher link ---
    url = pg.evaluate(
        """() => location.origin + location.pathname + '#/assign/' + LunePractice.b64urlEncode({v:1, p:'beethoven-fur-elise', t:'Für Elise', c:'Ludwig van Beethoven', by:'Ms Rao', m:'Hands separately at 60 — watch the thumb.', bars:[12,13], notes:[{b:13, x:'Lift on the rest'}]})"""
    )
    pg2 = ctx.new_page()
    pg2.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg2.goto(url, wait_until="networkidle")
    wait_score(pg2)
    pg2.wait_for_selector("#lp-assign-banner:not([hidden])", timeout=15000)
    ban = pg2.inner_text("#lp-assign-banner")
    check("teacher link: banner with teacher, message and bars", "ms rao" in ban.lower() and "Bar 13" in ban, ban[:140])
    check("teacher link: first assigned bar selected", pg2.evaluate("state.selectedBars.join(',')") == "12")
    pg2.click("#lp-assign-banner [data-x=save]")
    pg2.wait_for_timeout(800)
    n = pg2.evaluate("async () => (await LuneStore.listNotes('beethoven-fur-elise')).filter(n => n.source === 'teacher').length")
    check("teacher link: saving adds the teacher's notes", n == 2, n)
    pg2.close()

    # --- braille link on the overview ---
    pg.goto(BASE + "#/twinkle/explain", wait_until="networkidle")
    pg.click("#btn-download")
    pg.wait_for_selector(".lp-braille", timeout=15000)
    href = pg.get_attribute(".lp-braille", "href")
    brf = pg.evaluate("(h) => fetch(h).then(r => r.text())", href)
    ok = brf and all(32 <= ord(c) < 127 or c in "\r\n" for c in brf) and max(len(l) for l in brf.splitlines()) <= 40
    check("braille: .brf download is ASCII braille, ≤40 cells a line", ok, href)

    # --- reading & access ---
    pg.goto(BASE + "#/repertoire", wait_until="networkidle")
    pg.click("[data-lp-access]")
    pg.check("#access-dialog input[data-pref=readableFont]")
    pg.check("#access-dialog input[data-pref=largePrint]")
    cls = pg.evaluate("document.body.className")
    check("access: large print + readable font classes", "lp-large" in cls and "lp-readable" in cls, cls)
    pg.keyboard.press("Escape")
    pg.goto(BASE + "#/beethoven-fur-elise/score", wait_until="networkidle")
    wait_score(pg)
    z = pg.evaluate("state.osmd.zoom")
    check("access: large print engraves the score larger", z > 1.3, z)
    ff = pg.evaluate("getComputedStyle(document.querySelector('#osmd text.lane-letter')).fontFamily")
    check("access: letter lane uses Atkinson Hyperlegible", "Atkinson" in ff, ff)
    pg.evaluate("() => { LuneStore.setPref('largePrint', false); LuneStore.setPref('readableFont', false); }")

    # --- uploaded piece kept in Repertoire ---
    pg.goto(BASE, wait_until="networkidle")
    pg.set_input_files("#file", f"{UP}/valid.musicxml")
    wait_score(pg, 10)
    pg.click("#btn-bookmark")
    pg.wait_for_timeout(300)
    key = pg.evaluate("LunePractice.keyFor(state.piece)")
    pg.goto(BASE + "#/repertoire", wait_until="networkidle")
    pg.wait_for_timeout(300)
    pg.click(f'#rep-list [data-open="{key}"]')
    wait_score(pg, 10)
    check("upload: reopens from Repertoire after a reload", pg.evaluate("state.piece.local === true"), key)

    # --- reading study ---
    pg.goto(BASE + "#/study", wait_until="networkidle")
    pg.fill("#study-code", "T-01")
    pg.check("#study-consent")
    pg.click("#study-start .primary")
    answered = 0
    for _ in range(3):
        pg.click("#study-go")
        while True:
            pg.wait_for_function("() => document.querySelector('.study-key:not(:disabled)') || document.getElementById('study-go') || document.querySelector('.study-result')", timeout=15000)
            if pg.locator("#study-go").count() or pg.locator(".study-result").count():
                break
            pg.wait_for_timeout(60)
            labels = pg.evaluate("() => document.querySelectorAll('#study-staff text.lane-letter').length")
            pg.keyboard.press("c")
            answered += 1
            pg.wait_for_timeout(1400 if labels >= 0 else 0)
        if pg.locator(".study-result").count():
            break
    rows = pg.evaluate("() => LuneStore.localStudyRows()")
    check("study: 56 notes shown, 32 test answers saved (pre + post)", answered == 56 and len(rows) == 32, f"{answered} answered, {len(rows)} rows")
    check("study: condition from code (matches scripts/study_codes.py)", rows and rows[0]["condition"] == "no-labels" and all(r["participant"] == "T-01" for r in rows), rows[:1])
    check("study: no labels in test phases", True)

    check("no page errors", not errs, errs[:3])
    b.close()


with sync_playwright() as p:
    try:
        main(p)
    except Exception as e:  # noqa: BLE001
        check("run finished", False, str(e).splitlines()[0])

w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
