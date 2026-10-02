"""Verify the fix61 interaction model, advice engine, loader, and polish.

Run: .venv/bin/python scripts/verify_fix61.py
"""

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/"
SHOTS = Path(__file__).resolve().parent.parent / "tmp-verify-screenshots"
SHOTS.mkdir(exist_ok=True)

RESULTS = []


def check(name, ok, detail=""):
    RESULTS.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")


def bar_center(page, num):
    return page.evaluate(
        """(num) => {
          const host = document.getElementById('osmd');
          const b = LuneAnnotate.measureBoundsInHost(state.osmd, host, num);
          if (!b) return null;
          return {
            x: (b.screenLeft + b.screenRight) / 2,
            y: (b.screenTop + b.screenBottom) / 2,
          };
        }""",
        num,
    )


def open_fur_elise(page):
    page.fill("#q", "fur elise")
    page.wait_for_selector(".results .result", timeout=5000)
    page.click(".results .result")
    page.wait_for_selector("#panel-explain:not([hidden])", timeout=20000)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--autoplay-policy=no-user-gesture-required"]
        )

        # ---------------- Desktop ----------------
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        page.goto(BASE)

        html = page.content()
        check("cache busted to fix61", "v=fix61" in html and "v=fix60" not in html)

        open_fur_elise(page)
        page.screenshot(path=str(SHOTS / "01-desktop-explain.png"))

        # Loader should appear while the score is prepared (music21 ~seconds)
        page.click("#btn-explain-score")
        loader_seen = False
        try:
            page.wait_for_selector("#lune-loader:not([hidden])", timeout=4000)
            loader_seen = True
            page.screenshot(path=str(SHOTS / "02-loader.png"))
        except Exception:
            pass
        check("piano loader shown while preparing score", loader_seen)
        page.wait_for_selector("#osmd svg", timeout=40000)
        page.wait_for_selector("#lune-loader", state="hidden", timeout=40000)
        page.wait_for_timeout(800)
        check(
            "score hint visible when idle",
            page.is_visible("#score-hint")
            and "guidance" in page.text_content("#score-hint"),
            page.text_content("#score-hint") or "",
        )
        page.screenshot(path=str(SHOTS / "03-desktop-score.png"))

        # --- Paused: click a bar -> coach panel with advice + two play actions
        pt = bar_center(page, 3)
        check("measure bounds resolvable", bool(pt))
        page.mouse.click(pt["x"], pt["y"])
        page.wait_for_selector("#coach:not([hidden])", timeout=5000)
        body = page.text_content("#help-body") or ""
        specific = any(
            k in body for k in ["leap", "octave", "chord", "Syncopation", "chromatic",
                                "dotted", "between the beats", "spans"]
        )
        check("coach opens on paused bar click", page.is_visible("#coach"))
        check("advice is specific (intervals/notes/rhythm)", specific, body[:160])
        check("no vague 'needs care' copy", "needs care" not in body)
        check(
            "Play this bar + Play this line present",
            page.is_visible("#btn-hear") and page.is_visible("#btn-line")
            and "Play this bar" in (page.text_content("#btn-hear") or "")
            and "Play this line" in (page.text_content("#btn-line") or ""),
        )
        check("line summary present", "This line" in body, )
        page.wait_for_timeout(500)  # settle the panel animation
        page.screenshot(path=str(SHOTS / "04-desktop-coach.png"))

        # --- Play this bar: plays, then auto-pauses with playhead kept
        page.click("#btn-hear")
        page.wait_for_function("() => LunePiano.isPlaying()", timeout=15000)
        check("Play this bar starts playback", True)
        page.wait_for_function("() => !LunePiano.isPlaying()", timeout=30000)
        st = page.evaluate(
            "() => ({prog: LunePiano.progress(), dur: LunePiano.duration(),"
            " bar: LunePiano.currentBar(), ph: !document.getElementById('playhead-line').hidden})"
        )
        check(
            "bar snippet auto-pauses, playhead stays",
            0 < st["prog"] < st["dur"] - 1 and st["ph"],
            json.dumps(st),
        )

        # --- Play this line: plays several bars then pauses
        page.click("#btn-line")
        page.wait_for_function("() => LunePiano.isPlaying()", timeout=15000)
        line_bar0 = page.evaluate("() => LunePiano.currentBar()")
        page.wait_for_function("() => !LunePiano.isPlaying()", timeout=60000)
        line_bar1 = page.evaluate("() => LunePiano.currentBar()")
        check(
            "Play this line plays the system then pauses",
            line_bar1 >= line_bar0,
            f"from bar {line_bar0} to {line_bar1}",
        )

        # --- Play = whole piece from playhead; bar click while playing = seek
        page.click("#coach-close")
        page.click("#btn-stop")
        page.click("#btn-play-range")
        page.wait_for_function("() => LunePiano.isPlaying()", timeout=15000)
        kind = page.evaluate("() => state.timelineKind")
        dur = page.evaluate("() => LunePiano.duration()")
        check("Play arms whole-piece timeline", kind == "piece" and dur > 60,
              f"kind={kind} dur={dur:.0f}s")
        hint = page.text_content("#score-hint") or ""
        check("hint switches while playing", "jump" in hint, hint)

        target = bar_center(page, 8)
        page.mouse.click(target["x"], target["y"])
        page.wait_for_timeout(600)
        seek_st = page.evaluate(
            "() => ({bar: LunePiano.currentBar(), playing: LunePiano.isPlaying()})"
        )
        check(
            "bar click while playing seeks + keeps playing",
            seek_st["playing"] and abs(int(seek_st["bar"]) - 8) <= 1,
            json.dumps(seek_st),
        )
        check(
            "coach did NOT open on playing click",
            not page.is_visible("#coach"),
        )

        # --- Drag the playhead line backwards -> rewind (now at ~bar 8)
        before = page.evaluate("() => LunePiano.progress()")
        ph = page.locator("#playhead-line").bounding_box()
        back = bar_center(page, 2)
        page.mouse.move(ph["x"] + 1, ph["y"] + ph["height"] / 2)
        page.mouse.down()
        page.mouse.move(back["x"], back["y"], steps=12)
        page.mouse.up()
        page.wait_for_timeout(400)
        after = page.evaluate("() => LunePiano.progress()")
        bar_after = page.evaluate("() => LunePiano.currentBar()")
        check(
            "dragging playhead back rewinds",
            after < before - 0.5,
            f"{before:.1f}s -> {after:.1f}s (bar {bar_after})",
        )
        # --- and dragging forward advances
        before2 = page.evaluate("() => LunePiano.progress()")
        ph2 = page.locator("#playhead-line").bounding_box()
        fwd = bar_center(page, 10)
        page.mouse.move(ph2["x"] + 1, ph2["y"] + ph2["height"] / 2)
        page.mouse.down()
        page.mouse.move(fwd["x"], fwd["y"], steps=12)
        page.mouse.up()
        page.wait_for_timeout(400)
        after2 = page.evaluate("() => LunePiano.progress()")
        check(
            "dragging playhead forward advances",
            after2 > before2 + 0.5,
            f"{before2:.1f}s -> {after2:.1f}s",
        )
        page.click("#btn-stop")

        # --- old drag-region UI is gone
        check(
            "A-B region UI removed",
            page.evaluate("() => !document.getElementById('scrub-region')"),
        )
        page.screenshot(path=str(SHOTS / "05-desktop-final.png"))
        ctx.close()

        # ---------------- Phone (~390) ----------------
        ctx2 = browser.new_context(
            viewport={"width": 390, "height": 844},
            is_mobile=True,
            has_touch=True,
            device_scale_factor=3,
        )
        page2 = ctx2.new_page()
        page2.goto(BASE)
        open_fur_elise(page2)
        page2.screenshot(path=str(SHOTS / "06-phone-explain.png"))
        page2.click("#btn-explain-score")
        page2.wait_for_selector("#osmd svg", timeout=40000)
        page2.wait_for_selector("#lune-loader", state="hidden", timeout=40000)
        page2.wait_for_timeout(1000)
        page2.screenshot(path=str(SHOTS / "07-phone-score.png"))
        # Scroll bar 2 into view, then tap its centre
        page2.evaluate(
            """() => {
              const host = document.getElementById('osmd');
              const b = LuneAnnotate.measureBoundsInHost(state.osmd, host, 2);
              const scroll = document.getElementById('score-scroll');
              if (b && scroll) scroll.scrollTop = Math.max(0, b.top - 120);
            }"""
        )
        page2.wait_for_timeout(300)
        pt2 = bar_center(page2, 2)
        if pt2 and 0 < pt2["y"] < 844:
            hit = page2.evaluate(
                """(pt) => LuneAnnotate.measureAtPoint(
                     state.osmd, document.getElementById('osmd'), pt.x, pt.y)""",
                pt2,
            )
            page2.touchscreen.tap(pt2["x"], pt2["y"])
            try:
                page2.wait_for_selector("#coach:not([hidden])", timeout=5000)
                check("phone: tap bar opens coach", True, f"hit bar {hit}")
                page2.wait_for_timeout(600)  # let the sheet animation settle
                page2.screenshot(path=str(SHOTS / "08-phone-coach.png"))
                ok_btns = page2.is_visible("#btn-hear") and page2.is_visible("#btn-line")
                check("phone: play bar/line buttons visible", ok_btns)
            except Exception:
                check("phone: tap bar opens coach", False, f"hit bar {hit} at {pt2}")
                page2.screenshot(path=str(SHOTS / "08-phone-coach-fail.png"))
        else:
            check("phone: tap bar opens coach", False, f"bad point {pt2}")
        ctx2.close()
        browser.close()

    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(fails)}/{len(RESULTS)} checks passed")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
