#!/usr/bin/env python3
"""Build frontend/theme-light.css from frontend/styles.css.

Lune is designed dark. The light theme is three parts, in this order:

1. scripts/light_theme/base.css: the light rules generated for the lune04
   release. The script that made them was not kept, so they are frozen here
   as they shipped (and were checked by eye then).
2. Generated: every rule added to styles.css after lune04 (its selectors
   are not in light_theme/reviewed-selectors.txt) that sets a dark-theme
   colour gets a light version. Backgrounds, borders and
   outlines are mirrored (a near-black surface becomes a near-white one);
   text colours are darkened to keep the same contrast they had on the dark
   page, never below 4.5:1 on the light page. Rules already drawn in light
   colours (the white score paper, the coach card) are left alone.
3. KEEP: hand-written rules for anything the generated part gets wrong.
   They come last, so they win.

Run after any change to styles.css:  python3 scripts/build_light_theme.py
"""
from __future__ import annotations

import colorsys
import re
import sys
from pathlib import Path

import tinycss2

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "styles.css"
OUT = ROOT / "frontend" / "theme-light.css"
BASE = ROOT / "scripts" / "light_theme" / "base.css"
REVIEWED = ROOT / "scripts" / "light_theme" / "reviewed-selectors.txt"
P = 'html[data-theme="light"]'

PAGE = (0xF5, 0xF5, 0xF5)  # --bg in the light theme
DARK_PAGE = (0x0A, 0x0A, 0x0A)

TEXT_PROPS = {"color", "fill", "stroke", "caret-color", "text-decoration-color", "accent-color"}
SURFACE_PROPS = re.compile(r"^(background(-color)?|border(-[a-z]+)*|outline(-color)?|box-shadow)$")

# selectors that stay as they are in the light (white paper and things drawn on it)
NO_FLIP = re.compile(r"lune-key|lune-talk|\.lt-|lune-loader|lune-orb|fx-aurora|score-page|fx-paper|study-staff|#osmd|\.coach\b|lune-letter|lune-finger|lane-|\.lp-note|\.lp-grade|\.chip\b")

# Hand fixes, found by going through every screen in light mode. They win.
KEEP = """
/* KEEP: hand fixes */
html[data-theme="light"][data-theme="light"] #home-member .member-next .primary, html[data-theme="light"][data-theme="light"] .rep-card .primary { background: #2a44d8 !important; color: #ffffff !important; }
html[data-theme="light"][data-theme="light"] .lp-nav-cta, html[data-theme="light"][data-theme="light"] .hd-send, html[data-theme="light"][data-theme="light"] .lc-send, html[data-theme="light"][data-theme="light"] .lc-round { background: #2a44d8 !important; color: #ffffff !important; }
/* --dim text reaches 4.5:1 on the page and on surfaces (was #8a8a8a, 3.4:1) */
html[data-theme="light"] { --dim: #666666; }
/* the bar panel is white paper in both themes; these greys reach 4.5:1 on it */
html[data-theme="light"] #coach .lp-h { color: #5c5c5c; }
html[data-theme="light"] #coach .coach-advice p { color: #444444; }
html[data-theme="light"] #coach .coach-kicker,
html[data-theme="light"] #coach #help-body h4 { color: #666666; }
html[data-theme="light"] .onboard-progress li { color: #666666; }
html[data-theme="light"] .ask-form input:focus-visible { outline: 2px solid #0d0d0d; outline-offset: 1px; }
/* navy in the light: the fill stays navy (white text 10.6:1); focus and lines darken to read on white */
html[data-theme="light"] { --navy: #1f3a73; --navy-ink: #ffffff; --navy-soft: #eef2fa; --navy-line: #1f3a73; --focus: #1f3a73; }
/* the phone keyboard sits on the page, not on a dark keybed */
@media (max-width: 640px) {
  html[data-theme="light"] body.is-studio .piano-dock.is-slim .lune-kbd-track { background: #ececec; }
}
"""


# ---------------------------------------------------------------- colours

HEX = re.compile(r"#([0-9a-fA-F]{3,8})\b")
RGBA = re.compile(r"rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)")


def parse_hex(h: str):
    h = h.lower()
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    r, g, b = (int(h[i : i + 2], 16) for i in (0, 2, 4))
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return (r, g, b), a


def lum(rgb):
    def ch(c):
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (ch(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def fmt(rgb, a=1.0):
    if a >= 0.999:
        return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb)
    return "rgba(%d, %d, %d, %s)" % (*(int(round(c)) for c in rgb), ("%.3f" % a).rstrip("0").rstrip("."))


def mirror(rgb):
    """Flip lightness, keep hue: a near-black surface becomes a near-white one."""
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in rgb))
    return tuple(c * 255 for c in colorsys.hls_to_rgb(h, 1 - l, s))


def text_for_light(rgb):
    """Darken a light text colour so it keeps its contrast, at least 4.5:1, on the light page."""
    want = max(4.5, min(contrast(rgb, DARK_PAGE), 17))
    h, l, s = colorsys.rgb_to_hls(*(c / 255 for c in mirror(rgb)))
    lo, hi = 0.0, l
    for _ in range(30):  # the lightest shade that still reaches the contrast
        mid = (lo + hi) / 2
        cand = tuple(c * 255 for c in colorsys.hls_to_rgb(h, mid, s))
        if contrast(cand, PAGE) >= want:
            lo = mid
        else:
            hi = mid
    return tuple(c * 255 for c in colorsys.hls_to_rgb(h, lo, s))


def is_darkish(rgb):
    return lum(rgb) < 0.18


def map_value(prop: str, value: str):
    """Return (new value, changed) for one declaration."""
    changed = False
    text = prop in TEXT_PROPS

    def swap(rgb, a):
        nonlocal changed
        if prop == "box-shadow" and lum(rgb) < 0.02:  # black shadows: just softer
            changed = True
            return fmt(rgb, a * 0.23)
        if text:
            if lum(rgb) > 0.25:
                changed = True
                return fmt(text_for_light(rgb), a)
            return None
        if is_darkish(rgb) or (lum(rgb) > 0.8 and a < 0.5):  # dark surfaces, and faint white washes over them
            changed = True
            return fmt(mirror(rgb), a)
        return None

    def on_hex(m):
        rgb, a = parse_hex(m.group(1))
        return swap(rgb, a) or m.group(0)

    def on_rgba(m):
        rgb = tuple(float(m.group(i)) for i in (1, 2, 3))
        a = m.group(4)
        a = 1.0 if a is None else float(a[:-1]) / 100 if a.endswith("%") else float(a)
        return swap(rgb, a) or m.group(0)

    out = HEX.sub(on_hex, value)
    out = RGBA.sub(on_rgba, out)
    return out, changed


# ---------------------------------------------------------------- rules


def covered_selectors(css: str) -> set[str]:
    seen = set()

    def walk(rules):
        for r in rules:
            if r.type == "qualified-rule":
                for sel in tinycss2.serialize(r.prelude).split(","):
                    seen.add(sel.strip().replace(P, "", 1).strip())
            elif r.type == "at-rule" and r.content:
                walk(tinycss2.parse_rule_list(r.content, skip_comments=True, skip_whitespace=True))

    walk(tinycss2.parse_stylesheet(css, skip_comments=True, skip_whitespace=True))
    return seen


def generated(src: str, covered: set[str]) -> list[str]:
    out = []

    def rule_css(r, indent=""):
        sels = [s.strip() for s in tinycss2.serialize(r.prelude).split(",")]
        if any(s in covered for s in sels) or any(NO_FLIP.search(s) for s in sels):
            return None
        decls = [d for d in tinycss2.parse_declaration_list(r.content, skip_comments=True, skip_whitespace=True) if d.type == "declaration"]
        body = []
        for d in decls:
            if d.lower_name in TEXT_PROPS or SURFACE_PROPS.match(d.lower_name):
                val = tinycss2.serialize(d.value).strip()
                new, changed = map_value(d.lower_name, val)
                if changed:
                    body.append(f"{indent}  {d.name}: {new}{' !important' if d.important else ''};")
        if not body:
            return None
        head = ",\n".join(f"{indent}{P} {s}" if not s.startswith("html") else f"{indent}{s.replace('html', P, 1)}" for s in sels)
        return head + " {\n" + "\n".join(body) + f"\n{indent}}}"

    for r in tinycss2.parse_stylesheet(src, skip_comments=True, skip_whitespace=True):
        if r.type == "qualified-rule":
            css = rule_css(r)
            if css:
                out.append(css)
        elif r.type == "at-rule" and r.lower_at_keyword == "media" and r.content:
            inner = [rule_css(x, "  ") for x in tinycss2.parse_rule_list(r.content, skip_comments=True, skip_whitespace=True) if x.type == "qualified-rule"]
            inner = [x for x in inner if x]
            if inner:
                out.append(f"@media {tinycss2.serialize(r.prelude).strip()} {{\n" + "\n".join(inner) + "\n}")
    return out


def main():
    src = SRC.read_text(encoding="utf-8")
    base = BASE.read_text(encoding="utf-8")
    reviewed = {l.strip() for l in REVIEWED.read_text(encoding="utf-8").splitlines() if l.strip() and not l.startswith("#")}
    gen = generated(src, covered_selectors(base) | reviewed)
    css = (
        "/* Lune — light theme. GENERATED by scripts/build_light_theme.py from styles.css.\n"
        " * Do not edit by hand: change styles.css or the KEEP rules in the script, and run it again. */\n"
        + base.rstrip()
        + "\n\n/* generated from rules added to styles.css after lune04 */\n"
        + "\n".join(gen)
        + "\n"
        + KEEP.strip()
        + "\n"
    )
    OUT.write_text(css, encoding="utf-8")
    print(f"theme-light.css: {len(base.splitlines())} base lines, {len(gen)} generated rules, KEEP {len(KEEP.strip().splitlines()) - 1} lines")


if __name__ == "__main__":
    sys.exit(main())
