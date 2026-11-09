"""Offline after one visit: the service worker's copy is enough to read and hear a piece.

    .venv/bin/python scripts/offline_test.py [base-url]

Visits once online (the worker installs and keeps copies), opens a piece, then
cuts the network and checks that the app, that piece, search and the piano
sound engine still load from the cache.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from claude_test_state import browser_only, sign_in_locally  # noqa: E402

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/lune/"
PIECE = "debussy-clair-de-lune"
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:240]))


def wait_score(pg):
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 50", timeout=60000)


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    ctx = b.new_context(viewport={"width": 1280, "height": 860}, service_workers="allow")
    browser_only(ctx)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)[:200]))

    # online: first visit, worker installs, a piece is opened (its score is kept)
    pg.goto(BASE, wait_until="networkidle")
    sign_in_locally(pg)
    pg.evaluate("() => navigator.serviceWorker.ready")
    pg.wait_for_function(
        "async () => { const k = await caches.keys(); if (!k.length) return false; const c = await caches.open(k[0]); return !!(await c.match(new URL('static/vendor/Tone.js', location.href).href)); }",
        timeout=60000,
        polling=500,
    )
    check("online: the worker keeps the piano engine, though the page doesn't load it", True)
    # a worker controls pages loaded after it installs (no clients.claim): reload, then open the piece
    pg.reload(wait_until="networkidle")
    check("online: the page is now served through the worker", pg.evaluate("() => !!navigator.serviceWorker.controller"))
    pg.goto(BASE + f"#/{PIECE}/score", wait_until="networkidle")
    wait_score(pg)
    pg.wait_for_timeout(1500)

    # offline: real reloads (a change after '#' alone would not reload the page)
    ctx.set_offline(True)
    failed = []
    # the worker's own network attempt fails first by design (network-first); only the page's requests count
    # and a request cut short by the test's own reload (ERR_ABORTED) is not a missing file
    pg.on(
        "requestfailed",
        lambda r: failed.append(f"{r.url} {r.failure}")
        if r.url.startswith(BASE) and r.service_worker is None and "ERR_ABORTED" not in (r.failure or "")
        else None,
    )
    pg.goto(BASE, wait_until="load")
    pg.reload(wait_until="load")
    pg.wait_for_selector("#home:not([hidden])", timeout=20000)
    check("offline: the app opens on a reload", True)
    pg.goto(BASE + f"#/{PIECE}/score", wait_until="load")
    pg.reload(wait_until="load")
    try:
        wait_score(pg)
        check("offline: the piece opened online renders with its letter lane", True)
    except Exception as e:  # noqa: BLE001
        check("offline: the piece opened online renders with its letter lane", False, str(e).splitlines()[0])
    pg.goto(BASE, wait_until="load")
    pg.reload(wait_until="load")
    pg.wait_for_selector("#q", state="visible", timeout=20000)
    pg.fill("#q", "moonlight")
    pg.wait_for_timeout(1500)
    rows = pg.evaluate("() => [...document.querySelectorAll('#results .result')].map(e => e.innerText)")
    check("offline: search still finds pieces", any("Moonlight" in r for r in rows), rows[:2])
    tone = pg.evaluate("() => fetch('static/vendor/Tone.js').then(r => r.ok).catch(() => false)")
    check("offline: the piano engine loads from the cache", tone)
    check("offline: no app file failed to load", not failed, failed[:4])
    check("no page errors", not errs, errs[:3])
    b.close()

w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
sys.exit(0 if all(s == "PASS" for s, _, _ in out) else 1)
