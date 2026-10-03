"""Visitor states for the Playwright suites, set up through the app's own calls.

Lune's onboarding gate (frontend/onboard.js, applyGateChrome) disables
Repertoire and uploads until the device is unlocked, and hides search until the
visitor is signed in. Both states live in this browser's storage, so neither
needs the cloud.
"""

TEST_EMAIL = "tester@lune.test"


def browser_only(ctx):
    """Run the build with accounts switched off (an empty LUNE_CONFIG), so every
    write stays in this browser and nothing a test does reaches the live project."""
    ctx.route(
        "**/static/lune-config.js*",
        lambda r: r.fulfill(content_type="application/javascript", body="window.LUNE_CONFIG = {};"),
    )
    ctx.route("**://*.supabase.co/**", lambda r: r.abort())


def unlock_guest(pg):
    """Admit this device as a guest: Repertoire and uploads on, search still hidden."""
    pg.evaluate("() => LuneOnboard.requireUnlock()")
    pg.wait_for_selector("#btn-repertoire:not([disabled])")


def sign_in_locally(pg):
    """Sign in with a device-only account, then come back through the hello
    screen the way a returning member does, so search is on show."""
    pg.evaluate("(email) => { LuneOnboard.requireUnlock(); LuneStore.completeLocalSignIn(email); }", TEST_EMAIL)
    pg.reload(wait_until="networkidle")
    pg.click("#btn-hello-enter")
    pg.wait_for_selector("#home:not([hidden])")
    pg.wait_for_selector("#q", state="visible")
