#!/usr/bin/env python3
"""Generate Lune's light theme from its dark stylesheet.

Lune's stylesheet is written dark-first with literal colours. This script
reads frontend/styles.css and writes frontend/theme-light.css: for every rule
that sets a colour it emits the same rule under html[data-theme="light"]
with that colour's lightness mirrored (deep black ↔ off-white, light ink ↔
dark ink; hue and saturation kept, so the one navy accent stays navy).
The result is ordinary CSS with real colours. No filter is applied to the
page, so pictures, the piano keys and shadows are untouched.

Left alone on purpose:
  - anything drawn on the score's paper (it has its own light/dark handling)
  - the piano keys (ivory and black in both themes)
Shadows stay dark and get lighter, instead of turning into glows.

    python3 scripts/build_light_theme.py
"""
from __future__ import annotations

import colorsys
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "styles.css"
OUT = ROOT / "frontend" / "theme-light.css"

# Selectors for things that sit on the white score paper or are piano keys.
KEEP = re.compile(
    r"#osmd|#scan|\.score-page|\.fx-paper|\.fx-score|\.fx-bar-mark|\.fx-live-playhead|\.study-staff|"
    r"\.selection-hilites|\.sel-hilite|\.hover-hilite|\.measure-hilite|\.playhead-line|#playhead-line|\.lp-marks|\.lp-mark|\.lp-heat|\.lf-|"
    r"\.lune-kbd|\.sim-piano|\.sim-fall|\.piano-roll|"
    # the bar panel is paper too
    r"\.coach\b|\.coach-|\.help-actions|\.lp-coach|\.lp-note|\.lp-grade|\.lp-h\b|\.lp-due|\.lp-empty|\.lp-meta|\.lp-del|\.lp-mic|"
    r"\.lp-save|\.lp-teacher|\.lp-to-plan|\.lp-asked|\.lp-ask-row|\.lp-callout|\.chip\b|\.tone-|\.quiet\.ink"
)
COLOUR_PROPS = re.compile(
    r"^(color|background(-color|-image)?|border(-(top|right|bottom|left))?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|"
    r"caret-color|accent-color|text-decoration(-color)?|column-rule(-color)?|scrollbar-color|--[\w-]+)$"
)
# Class names used inside the bar panel (collected from the running app): paper too.
try:
    import json as _json

    _PAPER = _json.loads((ROOT / "scripts" / "paper_classes.json").read_text())
    PAPER = re.compile(r"\.(?:" + "|".join(re.escape(c) for c in _PAPER) + r")(?![\w-])") if _PAPER else None
except FileNotFoundError:
    PAPER = None
TOKEN = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|\b(?:white|black)\b")


def parse(tok: str):
    t = tok.strip().lower()
    if t == "white":
        return 1, 1, 1, 1
    if t == "black":
        return 0, 0, 0, 1
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        r, g, b = (int(h[i : i + 2], 16) / 255 for i in (0, 2, 4))
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1
        return r, g, b, a
    nums = re.findall(r"[\d.]+%?", t)
    if len(nums) < 3:
        return None
    r, g, b = (float(n.rstrip("%")) / (100 if n.endswith("%") else 255) for n in nums[:3])
    a = float(nums[3].rstrip("%")) / (100 if nums[3].endswith("%") else 1) if len(nums) > 3 else 1
    return r, g, b, a


def emit(r, g, b, a) -> str:
    r, g, b = (max(0, min(255, round(c * 255))) for c in (r, g, b))
    if a >= 0.999:
        return f"#{r:02x}{g:02x}{b:02x}"
    return f"rgba({r}, {g}, {b}, {round(a, 3)})"


def mirror(tok: str, shadow: bool, text: bool = False) -> str:
    c = parse(tok)
    if not c:
        return tok
    r, g, b, a = c
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    if shadow:
        # a dark shadow stays a dark shadow, only softer on a light page;
        # a light edge highlight becomes a faint dark edge
        return emit(0, 0, 0, a * (0.28 if l < 0.5 else 0.9))
    # 0.04 (#0a0a0a) ↔ 0.96 (#f5f5f5); never pure white or pure black for surfaces
    nl = 1 - l
    if s < 0.12:
        nl = min(0.985, max(0.05, nl))
        # Grey text that was quiet on black is too faint on white at the mirrored
        # value: darken mid-greys so muted text keeps its contrast.
        if text and 0.3 < nl < 0.8:
            nl *= 0.74
    r, g, b = colorsys.hls_to_rgb(h, nl, s)
    return emit(r, g, b, a)


def convert(prop: str, value: str) -> str | None:
    if not COLOUR_PROPS.match(prop) or "url(" in value and not TOKEN.search(value.split("url(")[0]):
        return None
    if not TOKEN.search(value):
        return None
    # the paper and its ink are the same in both themes
    if prop in ("--paper", "--ink", "--ink-muted", "--ink-line", "--hot"):
        return None
    shadow = prop in ("box-shadow", "text-shadow") or (prop.startswith("--") and "shadow" in prop)
    out = TOKEN.sub(lambda m: mirror(m.group(0), shadow, text=prop == "color"), value)
    return out if out != value else None


def blocks(css: str):
    """Yield (prelude, body) for each top-level block."""
    i, n = 0, len(css)
    while i < n:
        j = css.find("{", i)
        if j < 0:
            return
        depth, k = 1, j + 1
        while k < n and depth:
            depth += css[k] == "{"
            depth -= css[k] == "}"
            k += 1
        prelude = css[i:j].strip()
        # stray semicolon-terminated at-rules (@import, @charset) before a block
        if ";" in prelude:
            prelude = prelude.rsplit(";", 1)[1].strip()
        yield prelude, css[j + 1 : k - 1]
        i = k


def scope(selector: str) -> str | None:
    parts = []
    for sel in re.split(r",(?![^()]*\))", selector):
        s = sel.strip()
        if not s or KEEP.search(s) or (PAPER and PAPER.search(s)):
            continue
        if s.startswith(":root") or s == "html":
            s = 'html[data-theme="light"]' + s[len(":root") if s.startswith(":root") else 4 :]
        elif s.startswith("html"):
            s = 'html[data-theme="light"]' + s[4:]
        else:
            s = f'html[data-theme="light"] {s}'
        parts.append(s)
    return ",\n".join(parts) if parts else None


def rules(css: str, indent: str = "") -> list[str]:
    out = []
    for prelude, body in blocks(css):
        if prelude.startswith(("@keyframes", "@font-face", "@-webkit-keyframes")):
            continue
        if prelude.startswith("@"):
            inner = rules(body, indent + "  ")
            if inner:
                out.append(f"{indent}{prelude} {{\n" + "\n".join(inner) + f"\n{indent}}}")
            continue
        sel = scope(prelude)
        if not sel:
            continue
        decls = []
        changed = False
        for d in body.split(";"):
            if ":" not in d:
                continue
            prop, value = d.split(":", 1)
            prop, value = prop.strip(), value.strip()
            new = convert(prop, value)
            if new:
                changed = True
                decls.append(f"{indent}  {prop}: {new};")
            elif COLOUR_PROPS.match(prop) and not prop.startswith("--"):
                # Repeat colour declarations that need no change (transparent,
                # a variable) so this rule still wins where it won in the dark sheet.
                decls.append(f"{indent}  {prop}: {value};")
        if changed:
            out.append(f"{indent}{sel.replace(chr(10), chr(10) + indent)} {{\n" + "\n".join(decls) + f"\n{indent}}}")
    return out


def main() -> None:
    css = re.sub(r"/\*.*?\*/", "", SRC.read_text(), flags=re.S)
    body = rules(css)
    head = """/* Lune — light theme. GENERATED by scripts/build_light_theme.py from styles.css.
 * Do not edit by hand: change styles.css and run the script again. */
html[data-theme="light"] { color-scheme: light; }
/* the score page is white paper in the light: no flip */
html[data-theme="light"] .score-page,
html[data-theme="light"] .fx-paper,
html[data-theme="light"] .study-staff,
html[data-theme="light"] .selection-hilites,
html[data-theme="light"] .hover-hilite,
html[data-theme="light"] .measure-hilite,
html[data-theme="light"] .playhead-line,
html[data-theme="light"] .lp-marks,
html[data-theme="light"] .coach { filter: none; }
"""
    OUT.write_text(head + "\n".join(body) + "\n")
    print(f"{OUT.relative_to(ROOT)}: {len(body)} rule groups, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
