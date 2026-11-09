"""What loads when: the account library (supabase.js) and the piano sound (Tone.js).

Accounts are switched on, but every request to Supabase is answered here by a
stand-in, so nothing reaches the live project. Sound is checked under the
browser's normal autoplay rules: it must start from a real click.

    .venv/bin/python scripts/loading_test.py [base-url]
"""
import json
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8137/lune/"
out = []


def check(name, ok, detail=""):
    out.append(("PASS" if ok else "FAIL", name, str(detail)[:240]))


def fake_supabase(route):
    url = route.request.url
    if "/auth/v1/otp" in url:
        return route.fulfill(status=200, content_type="application/json", body="{}")
    if "/auth/v1/" in url:
        return route.fulfill(status=400, content_type="application/json", body=json.dumps({"error": "invalid_grant"}))
    return route.fulfill(status=200, content_type="application/json", body="[]")


def context(b, log, stored_session=False):
    ctx = b.new_context(viewport={"width": 1280, "height": 860})
    ctx.route("**://*.supabase.co/**", fake_supabase)
    if stored_session:
        ctx.add_init_script(
            """try { localStorage.setItem('sb-ggxbkynudklihxovqedv-auth-token', JSON.stringify({
              access_token: 'x', refresh_token: 'y', expires_at: 1, token_type: 'bearer', user: {id: 'u', email: 'm@lune.test'} })); } catch (e) {}"""
        )
    pg = ctx.new_page()
    pg.on("request", lambda r: log.append(("req", r.url)) if "vendor/supabase.js" in r.url or "supabase.co" in r.url else None)
    pg.on("domcontentloaded", lambda: log.append(("dcl", "")))
    pg.on("load", lambda: log.append(("load", "")))
    return ctx, pg


with sync_playwright() as p:
    b = p.chromium.launch(headless=True)

    # guest: not on the first screen's path, fetched once the page is idle
    log = []
    ctx, pg = context(b, log)
    pg.goto(BASE, wait_until="load")
    before_load = [u for k, u in log[: next(i for i, (k, _) in enumerate(log) if k == "load")] if k == "req"]
    check("guest: account library not fetched before the page has loaded", not before_load, before_load)
    pg.wait_for_function("() => !!window.supabase", timeout=15000)
    check("guest: account library fetched once the page is idle", any("vendor/supabase.js" in u for k, u in log if k == "req"))
    ctx.close()

    # guest who signs in at once: waits for the library, gets the emailed code, not a device-only account
    log = []
    ctx, pg = context(b, log)
    pg.goto(BASE, wait_until="domcontentloaded")
    pg.wait_for_function("() => !!window.LuneStore", timeout=15000)
    res = pg.evaluate("() => LuneStore.signIn('reader@lune.test')")
    st = pg.evaluate("() => LuneStore.status()")
    check("guest: signing in straight away asks the cloud for a code", res.get("mode") == "otp", res)
    check("guest: and waits for the code (not signed in on this device only)", st.get("awaitingCode") is True and st.get("signedIn") is False, st)
    check("guest: the code request went to Supabase", any("/auth/v1/otp" in u for k, u in log if k == "req"))
    ctx.close()

    # member with a stored session: library is part of startup, as before
    log = []
    ctx, pg = context(b, log, stored_session=True)
    pg.goto(BASE, wait_until="load")
    first = [k for k, u in log if k in ("load",) or (k == "req" and "vendor/supabase.js" in u)]
    check("member: account library fetched before the page finished loading", first[:1] == ["req"], first)
    ctx.close()

    # piano sound: not part of the home page; a score warms it up; Play works however long you wait
    log = []
    ctx, pg = context(b, log)
    pg.on("request", lambda r: log.append(("tone", r.url)) if "vendor/Tone.js" in r.url else None)
    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(3000)
    check("sound: Tone.js not fetched by the home page", not any(k == "tone" for k, _ in log) and pg.evaluate("typeof Tone") == "undefined")
    pg.goto(BASE + "#/debussy-clair-de-lune/score", wait_until="networkidle")
    pg.wait_for_function("() => document.querySelectorAll('#osmd .lane-letter').length > 50", timeout=60000)
    # the warm-up runs before any tap; it used to leave the first Play waiting forever
    pg.wait_for_timeout(5000)
    pg.click("#btn-play-range")
    try:
        pg.wait_for_function("() => window.LunePiano?.isPlaying?.()", timeout=60000)
        playing = True
    except Exception:  # noqa: BLE001
        playing = False
    st = pg.evaluate("() => ({ tone: typeof Tone, state: typeof Tone !== 'undefined' ? Tone.context.state : null, loader: !document.getElementById('lune-loader').hidden })")
    check("sound: Play pressed 5 s after opening a score starts playback", playing, st)
    check("sound: the audio context is running after that tap", st["state"] == "running", st)
    ctx.close()
    b.close()

w = max(len(n) for _, n, _ in out)
for s, n, d in out:
    print(f"{s}  {n.ljust(w)}  {d if s == 'FAIL' else ''}")
print(f"\n{sum(s == 'PASS' for s, _, _ in out)}/{len(out)} passed")
sys.exit(0 if all(s == "PASS" for s, _, _ in out) else 1)
