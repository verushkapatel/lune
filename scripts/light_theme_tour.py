#!/usr/bin/env python3
"""Screenshot every screen and dialog, for checking a theme by eye.

    python3 scripts/light_theme_tour.py [light|dark] [out-dir]

Writes <out-dir>/<width>-<screen>.png at 1280 and 390 px wide, and a contact
sheet per width (sheet-1280.png, sheet-390.png). Serve the site on 8137 first.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from lune_screens import BASE, READY, SCREENS  # noqa: E402
THEME = sys.argv[1] if len(sys.argv) > 1 else "light"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/lune-tour")
OUT.mkdir(parents=True, exist_ok=True)
ONLY = set(sys.argv[3].split(",")) if len(sys.argv) > 3 else None

def shoot(browser, width, height):
    shots = []
    for name, (url, js, wait) in SCREENS.items():
        if ONLY and name not in ONLY:
            continue
        ctx = browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
        pg = ctx.new_page()
        pg.add_init_script(f"try {{ localStorage.setItem('lune.theme', '{THEME}'); }} catch (e) {{}}")
        try:
            pg.goto(url, wait_until="networkidle")
            if "score" in url or "piano" in url:
                pg.wait_for_function(READY, timeout=60000)
            if js:
                pg.evaluate(js)
            pg.wait_for_timeout(wait)
            path = OUT / f"{width}-{name}.png"
            pg.screenshot(path=str(path))
            shots.append((name, path))
        except Exception as e:  # keep going: a missing screen shows as a gap in the sheet
            print(f"{width} {name}: {e!r}"[:200])
        ctx.close()
    return shots


def sheet(shots, width, cols):
    from PIL import Image, ImageDraw

    thumbs = []
    for name, path in shots:
        im = Image.open(path).convert("RGB")
        scale = 420 / im.width if width > 600 else 220 / im.width
        im = im.resize((int(im.width * scale), int(im.height * scale)))
        canvas = Image.new("RGB", (im.width, im.height + 18), "white")
        canvas.paste(im, (0, 18))
        ImageDraw.Draw(canvas).text((4, 3), name, fill="black")
        thumbs.append(canvas)
    if not thumbs:
        return
    w = max(t.width for t in thumbs)
    h = max(t.height for t in thumbs)
    rows = (len(thumbs) + cols - 1) // cols
    big = Image.new("RGB", (cols * (w + 6), rows * (h + 6)), "#888888")
    for i, t in enumerate(thumbs):
        big.paste(t, ((i % cols) * (w + 6), (i // cols) * (h + 6)))
    big.save(OUT / f"sheet-{width}.png")


with sync_playwright() as p:
    b = p.chromium.launch()
    for width, height, cols in ((1280, 860, 4), (390, 844, 7)):
        shots = shoot(b, width, height)
        if not ONLY:
            sheet(shots, width, cols)
        print(f"{width}: {len(shots)}/{len(SCREENS)} screens")
    b.close()
