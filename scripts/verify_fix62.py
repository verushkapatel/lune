"""fix62 verification: removal, premium pass, shortcuts, PWA, both breakpoints."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).resolve().parent.parent / "tmp-verify-screenshots"
OUT.mkdir(exist_ok=True)

results = {}
console_errors = []


def open_piece(page, query="mazurka 06 2"):
    page.goto(BASE + "/?v=fix62", wait_until="networkidle")
    page.wait_for_function("() => typeof opensheetmusicdisplay !== 'undefined'")
    page.fill("#q", query)
    page.wait_for_timeout(300)
    page.press("#q", "Enter")
    page.wait_for_function("() => !document.getElementById('studio')?.hidden", timeout=60000)
    page.wait_for_timeout(800)


def run(width, label):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--autoplay-policy=no-user-gesture-required"],
        )
        page = browser.new_page(viewport={"width": width, "height": 900 if width > 500 else 844})
        page.on("console", lambda m: console_errors.append(f"[{label}] {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(f"[{label}] pageerror {e}"))

        # 1. Home
        page.goto(BASE + "/?v=fix62", wait_until="networkidle")
        page.wait_for_timeout(1300)
        page.screenshot(path=str(OUT / f"fix62-home-{label}.png"))
        page.evaluate("() => document.querySelector('.home').scrollTo(0, 99999)")
        page.wait_for_timeout(700)
        page.screenshot(path=str(OUT / f"fix62-home-footer-{label}.png"))

        # PWA checks (once)
        if label == "desk":
            man = page.evaluate("""async () => {
              const link = document.querySelector('link[rel=manifest]');
              if (!link) return {ok:false, err:'no link'};
              const res = await fetch(link.href);
              if (!res.ok) return {ok:false, err:res.status};
              const j = await res.json();
              const icons = await Promise.all((j.icons||[]).map(async i => {
                const r = await fetch(i.src); return {src:i.src, ok:r.ok};
              }));
              const apple = document.querySelector('link[rel=apple-touch-icon]');
              const appleOk = apple ? (await fetch(apple.href)).ok : false;
              const theme = document.querySelector('meta[name=theme-color]')?.content;
              return {ok:true, name:j.name, display:j.display, icons, appleOk, theme};
            }""")
            results["pwa"] = man

        # 2. Search dropdown with keyboard nav
        page.evaluate("() => document.querySelector('.home').scrollTo(0, 0)")
        page.fill("#q", "nocturne")
        page.wait_for_timeout(400)
        page.press("#q", "ArrowDown")
        page.press("#q", "ArrowDown")
        page.wait_for_timeout(200)
        results[f"search-active-{label}"] = page.evaluate(
            "() => !!document.querySelector('.result.is-active')")
        page.screenshot(path=str(OUT / f"fix62-search-{label}.png"))

        # 3. Open piece -> Explain
        open_piece(page)
        page.click("#tab-explain")
        page.wait_for_timeout(900)
        explain_text = page.evaluate(
            "() => document.getElementById('panel-explain')?.textContent || ''")
        results[f"ask-gone-{label}"] = "Ask about a bar" not in explain_text
        results[f"no-bars-strip-{label}"] = page.evaluate(
            "() => !document.getElementById('bars') && !document.querySelector('.explain-ask')")
        page.screenshot(path=str(OUT / f"fix62-explain-{label}.png"))
        page.evaluate("() => document.getElementById('panel-explain').scrollTo(0, 99999)")
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / f"fix62-explain-bottom-{label}.png"))

        # 4. Score
        page.click("#tab-score")
        page.wait_for_function("() => !!document.querySelector('#osmd svg')", timeout=90000)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(OUT / f"fix62-score-{label}.png"))

        # Bar click -> coach
        box = page.evaluate("""() => {
          const svg = document.querySelector('#osmd svg');
          const r = svg.getBoundingClientRect();
          return {x: r.left + r.width*0.4, y: r.top + 60};
        }""")
        page.mouse.click(box["x"], box["y"])
        page.wait_for_timeout(700)
        results[f"coach-open-{label}"] = page.evaluate(
            "() => !document.getElementById('coach').hidden")
        page.screenshot(path=str(OUT / f"fix62-coach-{label}.png"))

        # Esc closes coach
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)
        results[f"esc-closes-coach-{label}"] = page.evaluate(
            "() => document.getElementById('coach').hidden")

        # Annotate toggle: Fingers then Off then Notes
        page.click("#anno-fingers", force=True)
        page.wait_for_timeout(1200)
        fingers = page.evaluate("() => document.querySelectorAll('#osmd text.lune-finger').length")
        page.click("#anno-off", force=True)
        page.wait_for_timeout(800)
        off = page.evaluate(
            "() => document.querySelectorAll('#osmd text.lune-finger, #osmd text.lune-letter').length")
        page.click("#anno-notes", force=True)
        page.wait_for_timeout(1200)
        letters = page.evaluate("() => document.querySelectorAll('#osmd text.lune-letter').length")
        results[f"annotate-{label}"] = {"fingers": fingers, "off": off, "letters": letters}

        # Space = play (desktop only; audio needs network once)
        if label == "desk":
            page.keyboard.press("Space")
            for _ in range(30):
                page.wait_for_timeout(1000)
                st = page.evaluate(
                    "() => ({playing: LunePiano.isPlaying(), tl: LunePiano.hasTimeline(), ready: LunePiano.isReady?.()})")
                if st["playing"]:
                    break
            results["space-plays"] = st
            page.wait_for_timeout(1500)
            page.screenshot(path=str(OUT / "fix62-score-playing-desk.png"))
            bar_before = page.evaluate("() => LunePiano.currentBar()")
            page.keyboard.press("ArrowRight")
            page.wait_for_timeout(600)
            bar_after = page.evaluate("() => LunePiano.currentBar()")
            results["arrow-seeks"] = {"before": bar_before, "after": bar_after}
            page.keyboard.press("Space")
            page.wait_for_timeout(400)
            results["space-pauses"] = page.evaluate("() => !LunePiano.isPlaying()")
            if page.evaluate("() => !document.getElementById('btn-stop').disabled"):
                page.click("#btn-stop")
            page.wait_for_timeout(300)

        # 5. Piano tab
        page.click("#tab-piano")
        page.wait_for_timeout(900)
        results[f"piano-keys-{label}"] = page.evaluate(
            "() => document.querySelectorAll('#lune-keyboard .lune-key').length")
        page.screenshot(path=str(OUT / f"fix62-piano-{label}.png"))

        # layout overflow check
        results[f"overflow-{label}"] = page.evaluate(
            "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2")

        browser.close()


run(1440, "desk")
run(390, "phone")

results["console_errors"] = [e for e in console_errors if "favicon" not in e]
print(json.dumps(results, indent=2))
print("SHOTS:", sorted(x.name for x in OUT.glob("fix62-*.png")))
