"""fix67 overlay audit matrix: Elise, Mazurka, Liebestraum at 5 widths × Notes/Fingers."""
from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8000/?v=fix67"
OUT = Path(__file__).resolve().parent.parent / "tmp-verify-screenshots"
OUT.mkdir(exist_ok=True)

WIDTHS = [375, 591, 768, 1024, 1440]
PIECES = [
    ("elise", "fur elise"),
    ("mazurka", "mazurka 06 2"),
    ("liebestraum", "liebestraum"),
]


def wait_overlays(page, sel, min_n=1, timeout_ms=25000):
    try:
        page.wait_for_selector("#osmd:not([data-partial]) svg", state="attached", timeout=min(timeout_ms, 20000))
    except Exception:
        page.wait_for_timeout(800)
    deadline = time.time() + timeout_ms / 1000
    last = -1
    stable = 0
    while time.time() < deadline:
        n = page.locator(sel).count()
        check = page.evaluate("() => window.__luneLastCheck")
        if n == last and n >= min_n and check is not None:
            stable += 1
            if stable >= 3:
                page.wait_for_timeout(150)
                return n
        else:
            stable = 0
            last = n
        page.wait_for_timeout(220)
    return page.locator(sel).count()


def set_mode(page, mode):
    page.evaluate(
        """(mode) => {
          const el = document.getElementById('anno-' + mode);
          if (!el) return;
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        mode,
    )
    page.wait_for_timeout(250)


def open_piece(page, query):
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_function("() => typeof opensheetmusicdisplay !== 'undefined' && typeof LuneAnnotate !== 'undefined'")
    page.fill("#q", query)
    page.wait_for_timeout(400)
    page.press("#q", "Enter")
    page.wait_for_function("() => !document.getElementById('studio')?.hidden", timeout=90000)
    page.click("#tab-score")
    page.wait_for_selector("#osmd:not([data-partial]) svg", timeout=90000)
    page.wait_for_timeout(600)


def snapshot(page, piece, width, mode):
    sel = "text.lune-finger" if mode == "fingers" else "text.lune-letter"
    wait_overlays(page, sel, min_n=1, timeout_ms=25000)
    data = page.evaluate(
        """() => {
          const host = document.getElementById('osmd');
          const result = LuneAnnotate.auditOverlays(host);
          const letters = host.querySelectorAll('text.lune-letter').length;
          const fingers = host.querySelectorAll('text.lune-finger').length;
          const nodes = [...host.querySelectorAll('text.lune-letter, text.lune-finger')];
          const fs = nodes.map((t) => Number(t.getAttribute('font-size') || 0));
          const svg = host.querySelector('svg');
          const ctm = svg && svg.getScreenCTM && svg.getScreenCTM();
          const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 1;
          return {
            audit: result,
            letters: letters,
            fingers: fingers,
            expected: window.__luneExpected || null,
            fontMin: fs.length ? Math.min.apply(null, fs) : null,
            fontMax: fs.length ? Math.max.apply(null, fs) : null,
            scale: scale,
            fontMinPx: fs.length ? Math.min.apply(null, fs) * scale : null,
            pass: window.__luneOverlayPass,
            leaders: window.__luneLeaders || [],
            last: window.__luneLastCheck || null,
            xorOk: (letters === 0 || fingers === 0) && !(letters && fingers)
          };
        }"""
    )
    name = f"fix67-{piece}-{mode}-{width}"
    page.screenshot(path=str(OUT / f"{name}.png"), full_page=False)
    return data


def main():
    print("fix67 matrix start", flush=True)
    rows = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--autoplay-policy=no-user-gesture-required"])
        for piece, query in PIECES:
            page = browser.new_page(viewport={"width": 1024, "height": 900})
            page.on("pageerror", lambda e: print("PAGEERROR", e))
            print("open", piece, query, flush=True)
            open_piece(page, query)
            print("opened", piece, flush=True)
            set_mode(page, "notes")
            for width in WIDTHS:
                page.set_viewport_size({"width": width, "height": 844 if width < 600 else 900})
                page.wait_for_timeout(1200)
                print(f"  {piece} {width} notes", flush=True)
                set_mode(page, "notes")
                rows.append({"piece": piece, "width": width, "mode": "notes", **snapshot(page, piece, width, "notes")})
                print(f"    notes ok={(rows[-1].get('audit') or {}).get('ok')} n={rows[-1].get('letters')}", flush=True)
                print(f"  {piece} {width} fingers", flush=True)
                set_mode(page, "fingers")
                rows.append({"piece": piece, "width": width, "mode": "fingers", **snapshot(page, piece, width, "fingers")})
                print(f"    fingers ok={(rows[-1].get('audit') or {}).get('ok')} n={rows[-1].get('fingers')}", flush=True)
                # XOR + stray-node cycle
                set_mode(page, "off")
                page.wait_for_timeout(400)
                off = page.evaluate(
                    """() => ({
                      letters: document.querySelectorAll('text.lune-letter').length,
                      fingers: document.querySelectorAll('text.lune-finger').length,
                    })"""
                )
                rows[-1]["offAfter"] = off
                set_mode(page, "notes")
                page.wait_for_timeout(500)
            # live resize while open
            page.set_viewport_size({"width": 1440, "height": 900})
            page.wait_for_timeout(400)
            page.set_viewport_size({"width": 375, "height": 844})
            page.wait_for_timeout(800)
            set_mode(page, "notes")
            rows.append({"piece": piece, "width": "live375", "mode": "notes", **snapshot(page, piece, "live375", "notes")})
            page.close()

        browser.close()

    slim = []
    for r in rows:
        counts = (r.get("audit") or {}).get("counts") or {}
        slim.append({
            "piece": r["piece"],
            "width": r["width"],
            "mode": r["mode"],
            "ok": (r.get("audit") or {}).get("ok"),
            "labelCount": (r.get("audit") or {}).get("labelCount"),
            "letters": r.get("letters"),
            "fingers": r.get("fingers"),
            "expected": r.get("expected"),
            "counts": counts,
            "fontMinPx": r.get("fontMinPx"),
            "xorOk": r.get("xorOk"),
            "leaders": r.get("leaders"),
            "offAfter": r.get("offAfter"),
            "pass": r.get("pass"),
        })
    report = OUT / "fix67_report.json"
    report.write_text(json.dumps(slim, indent=2))
    print(json.dumps(slim, indent=2))
    print("wrote", report)


if __name__ == "__main__":
    main()
