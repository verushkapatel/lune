#!/usr/bin/env python3
"""Colour contrast of visible text on every screen, in both themes.

    python3 scripts/contrast_audit.py [light|dark|both] [width ...]

For each text element it works out the colour actually painted behind it
(walking up to the first opaque background and blending any translucent ones
on the way) and checks WCAG AA: 4.5:1, or 3:1 for large text (24 px, or
18.66 px bold). Text over a photograph or gradient is skipped and counted,
since its background cannot be read from CSS. Disabled controls, placeholder
text and screen-reader-only text are exempt, as WCAG allows.

Screens come from scripts/lune_screens.py: the landing page, signed-in home,
search, a piece's Explain, Score and Piano tabs, the bar panel, Ask Lune,
Repertoire, Settings, Install, onboarding, sign-in, This week, Share this
week, the shared week page, the example week, Work on this piece, Feedback,
Credits and Reading and access.
"""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent))
from lune_screens import READY, SCREENS  # noqa: E402

THEMES = {"both": ["dark", "light"]}.get(sys.argv[1] if len(sys.argv) > 1 else "both", [sys.argv[1] if len(sys.argv) > 1 else "dark"])
WIDTHS = [int(w) for w in sys.argv[2:]] or [1280, 390]

AUDIT_JS = r"""
() => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
    return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
  };
  const over = (top, under) => {
    const a = top[3];
    return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1);
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function backdrop(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none" && !/^url\(.*\.svg/.test(cs.backgroundImage)) return null; // photo or gradient
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) {
        layers.push(bg);
        if (bg[3] >= 0.999) break;
      }
      if (n === document.documentElement && !(bg && bg[3] >= 0.999)) layers.push([255, 255, 255, 1]);
    }
    let c = layers.pop() || [255, 255, 255, 1];
    while (layers.length) c = over(layers.pop(), c);
    return c;
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.05) return false;
    }
    // under an open modal dialog, only the dialog counts
    const modal = [...document.querySelectorAll("dialog[open]")].pop();
    if (modal && !modal.contains(el)) return false;
    return true;
  };
  const out = [];
  let skipped = 0;
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT", "OPTION"].includes(el.tagName.toUpperCase()) || el.closest("svg")) continue; // SVG text is painted with fill, on the score
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own || !visible(el)) continue;
    if (el.closest("[disabled], [aria-disabled=true], .visually-hidden, .sr-only, [aria-hidden=true]")) continue;
    const cs = getComputedStyle(el);
    let alpha = 1;
    for (let n = el; n; n = n.parentElement) alpha *= Number(getComputedStyle(n).opacity);
    const fg = parse(cs.color);
    if (!fg) continue;
    let bg = backdrop(el);
    if (!bg) { skipped++; continue; }
    let shown = over([fg[0], fg[1], fg[2], fg[3] * alpha], bg);
    // paper drawn white and turned dark with filter: invert(1) (the bar panel at night)
    let flips = 0;
    for (let n = el; n; n = n.parentElement) if (/invert\(1\)/.test(getComputedStyle(n).filter)) flips++;
    if (flips % 2) {
      shown = shown.map((v, i) => (i < 3 ? 255 - v : v));
      bg = bg.map((v, i) => (i < 3 ? 255 - v : v));
    }
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    const r = ratio(shown, bg);
    if (r + 0.005 < need) {
      const sel = el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
      const key = sel + own.slice(0, 30);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ sel, text: own.slice(0, 50), ratio: Math.round(r * 100) / 100, need });
    }
  }
  return { fails: out, skipped };
}
"""


def main():
    total = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        for theme in THEMES:
            for width in WIDTHS:
                for name, (url, js, wait) in SCREENS.items():
                    ctx = b.new_context(viewport={"width": width, "height": 860 if width > 600 else 844})
                    pg = ctx.new_page()
                    pg.add_init_script(f"try {{ localStorage.setItem('lune.theme', '{theme}'); }} catch (e) {{}}")
                    # entrance animations would be caught half-faded
                    pg.add_init_script("addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important}'; document.head.appendChild(s); });")
                    try:
                        pg.goto(url, wait_until="networkidle")
                        if "score" in url or "piano" in url:
                            pg.wait_for_function(READY, timeout=60000)
                        if js:
                            pg.evaluate(js)
                        pg.wait_for_timeout(wait)
                        res = pg.evaluate(AUDIT_JS)
                    except Exception as e:
                        print(f"FAIL  {theme} {width} {name}: could not open ({e!r})"[:200])
                        total += 1
                        ctx.close()
                        continue
                    for f in res["fails"]:
                        print(f"FAIL  {theme} {width} {name}: {f['sel']} “{f['text']}” {f['ratio']}:1 (needs {f['need']})")
                    total += len(res["fails"])
                    ctx.close()
        b.close()
    screens = len(SCREENS) * len(THEMES) * len(WIDTHS)
    print(f"\n{screens} screens checked, {total} contrast failures")
    sys.exit(1 if total else 0)


if __name__ == "__main__":
    main()
