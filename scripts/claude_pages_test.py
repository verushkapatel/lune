"""Checks for the static (GitHub Pages) build, one per launch-review item.

Serve the export under /lune/ (e.g. `python3 -m http.server 8100` in the parent
folder), then:  python3 scripts/claude_pages_test.py [base-url] [upload-dir]
"""
import json
import sys
import time
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8100/lune/"
UP = sys.argv[2] if len(sys.argv) > 2 else "/tmp/up"
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:220]))


def search_rows(pg, q):
    pg.fill("#q", "")
    pg.fill("#q", q)
    pg.wait_for_timeout(450)
    return pg.evaluate(
        "() => [...document.querySelectorAll('#results .result, .results .result')].map(e => e.innerText.replace(/\\n+/g,' | ')).filter(t => t && !/no match|no free|no pieces found/i.test(t))"
    )


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1280, "height": 860})
    pg = ctx.new_page()
    errs, api_calls = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))
    pg.on("request", lambda r: api_calls.append(r.url) if "/api/" in r.url else None)
    pg.goto(BASE, wait_until="networkidle")

    # --- search ---
    rows = search_rows(pg, "moonlite")
    check("search: 'moonlite' finds Moonlight", any("Moonlight" in r for r in rows), rows[:3])
    rows = search_rows(pg, "river flows in you")
    check("search: 'river flows in you' returns nothing unrelated", not rows, rows[:3])
    rows = search_rows(pg, "fur elise")
    check("search: Für Elise listed once", sum("Elise" in r for r in rows) == 1, rows[:4])
    rows = search_rows(pg, "chopin")
    titles = [r.split(" | ")[0] for r in rows]
    check("search: no duplicate titles for 'chopin'", len(titles) == len(set(titles)), titles)
    rows = search_rows(pg, "gymnopedy")
    check("search: typo 'gymnopedy'", any("Gymnop" in r for r in rows), rows[:2])
    rows = search_rows(pg, "op 10")
    check("search: 'op 10' only op. 10", all("10" in r for r in rows) and rows, rows[:3])

    # --- every catalogue entry opens the piece it names ---
    opens = pg.evaluate("() => fetch('static/opens.json').then(r => r.json())")
    idx = pg.evaluate("() => fetch('static/search-index.json').then(r => r.json())")
    check("catalogue: index == openable pieces", len(idx["items"]) == len(opens), f"{len(idx['items'])} vs {len(opens)}")
    bad = []
    for row in opens:
        r = pg.evaluate(
            "async (id) => { const p = await tryOpenStatic({query: id, analyze: true}); return {kind: p.kind, title: p.title || p.overview?.title, bars: Object.keys(p.debriefs||{}).length, story: !!(p.overview?.composerInfo?.bio || p.overview?.composerInfo?.full || p.overview?.composerInfo?.hook)}; }",
            row["id"],
        )
        if r["kind"] != "score" or r["title"] != row["title"] or r["bars"] < 1:
            bad.append((row["id"], r))
    check(f"catalogue: all {len(opens)} entries open the named piece with bar data", not bad, bad[:3])

    # --- open + practice notes ---
    pg.goto(BASE + "#/beethoven-fur-elise/score", wait_until="networkidle")
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 100", timeout=60000)
    check("link: #/beethoven-fur-elise/score opens the score", True)
    explain_text = pg.evaluate("() => document.getElementById('panel-explain')?.innerText || ''")
    check("explain: 'Famous for a reason' at most once", explain_text.count("Famous for a reason") <= 1, explain_text.count("Famous for a reason"))
    t = pg.evaluate("() => (document.getElementById('time-label')||document.querySelector('.time, #scrub-time, [id*=time]')||{}).textContent || ''")
    check("time: duration shown before play", t and not t.strip().endswith("0:00 / 0:00") and "/ 0:00" not in t, t)
    box = pg.locator("#osmd svg").bounding_box()
    pg.mouse.click(box["x"] + box["width"] * 0.45, box["y"] + 200)
    pg.wait_for_timeout(700)
    chip = pg.evaluate("""() => { const b = document.querySelector('.chip.finger-only b, .tone-finger'); if (!b) return null; const cs = getComputedStyle(b); const bg = getComputedStyle(b.closest('.chip')); return {c: cs.color, bg: bg.backgroundColor}; }""")
    check("bar panel: finger digits have a visible colour", chip and chip["c"] != chip["bg"], chip)
    if pg.locator("#btn-plan").count() and pg.locator("#btn-plan").is_visible():
        pg.click("#btn-plan")
        pg.wait_for_timeout(500)
        body = pg.evaluate("() => document.getElementById('help-body')?.innerText || ''")
        check("practice notes build without a server", "Name the notes" in body, body[:120])
    else:
        check("practice notes button present", False, "hidden")

    # --- routing / back ---
    pg.goto(BASE, wait_until="networkidle")
    pg.fill("#q", "clair de lune")
    pg.wait_for_timeout(400)
    pg.press("#q", "Enter")
    pg.wait_for_function("() => !document.getElementById('studio')?.hidden", timeout=30000)
    pg.wait_for_timeout(300)
    h1 = pg.evaluate("() => location.hash")
    check("link: opening a piece changes the URL", h1.startswith("#/debussy-clair-de-lune"), h1)
    pg.go_back()
    pg.wait_for_timeout(800)
    check("back: returns home inside the site", pg.url.startswith(BASE) and pg.evaluate("() => !document.getElementById('home').hidden"), pg.url)
    pg.go_forward()
    pg.wait_for_timeout(1500)
    check("forward: piece again", pg.evaluate("() => !document.getElementById('studio').hidden"), pg.url)

    # --- uploads ---
    cases = [
        ("valid.musicxml", True), ("elise.mxl", True), ("bad.musicxml", False), ("notes.txt", False),
        ("broken.pdf", False), ("photo.png", False), ("empty.musicxml", False),
    ]
    for name, should_open in cases:
        pg.goto(BASE, wait_until="networkidle")
        pg.set_input_files("#file", f"{UP}/{name}")
        try:
            if should_open:
                pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 10", timeout=40000)
                n = pg.evaluate("() => document.querySelectorAll('#osmd .lane-letter').length")
                fingers = pg.evaluate("() => Object.values(state.piece.debriefs).reduce((a,d)=>a+(d.rh||[]).concat(d.lh||[]).filter(n=>n.fingering).length,0)")
                check(f"upload {name}: opens with letters + fingers", n > 10 and fingers > 10, f"{n} letters, {fingers} fingered")
            else:
                pg.wait_for_function("() => !document.getElementById('toast').hidden", timeout=15000)
                msg = pg.evaluate("() => document.getElementById('toast').textContent")
                check(f"upload {name}: clear message", msg and "Could not open file" not in msg, msg)
        except Exception as e:  # noqa: BLE001
            check(f"upload {name}", False, str(e).splitlines()[0])

    check("no calls to a missing /api server", not api_calls, api_calls[:3])
    check("no page errors", not errs, errs[:3])
    b.close()

w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
