"""Generate B&W PWA icons from the Lune crescent mark via Playwright."""
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(__file__).resolve().parent.parent / "frontend" / "assets"

# Crescent mark + faint staff lines on a night field. Maskable variant keeps
# the mark inside the 80% safe zone (bigger padding).
def icon_html(size: int, pad_ratio: float) -> str:
    inner = size * (1 - 2 * pad_ratio)
    offset = size * pad_ratio
    return f"""<!DOCTYPE html>
<html><head><style>
  html,body {{ margin:0; padding:0; background:#0a0a0a; width:{size}px; height:{size}px; overflow:hidden; }}
</style></head><body>
<svg width="{size}" height="{size}" viewBox="0 0 {size} {size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="{size}" height="{size}" fill="#0a0a0a"/>
  <svg x="{offset}" y="{offset}" width="{inner}" height="{inner}" viewBox="0 0 40 40">
    <g stroke="#f5f5f5" stroke-width="1" stroke-linecap="round" opacity="0.4">
      <line x1="5" y1="24" x2="35" y2="24"/>
      <line x1="5" y1="28" x2="35" y2="28"/>
      <line x1="5" y1="32" x2="35" y2="32"/>
    </g>
    <path fill="#f5f5f5" d="M26.2 7.2c-5.9.9-10.4 6-10.4 12.1 0 6.1 4.5 11.2 10.4 12.1A12.2 12.2 0 0 1 14 19.3c0-6.6 5.2-12 11.8-12.2.1 0 .3 0 .4 0z"/>
  </svg>
</svg>
</body></html>"""

JOBS = [
    ("icon-192.png", 192, 0.14),
    ("icon-512.png", 512, 0.14),
    ("icon-maskable-512.png", 512, 0.22),
    ("apple-touch-icon.png", 180, 0.16),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, size, pad in JOBS:
        page = browser.new_page(viewport={"width": size, "height": size})
        page.set_content(icon_html(size, pad))
        page.screenshot(path=str(OUT / name))
        page.close()
    browser.close()

print("wrote", [j[0] for j in JOBS])
