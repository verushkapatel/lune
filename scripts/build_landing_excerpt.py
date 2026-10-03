#!/usr/bin/env python3
"""Cut the opening bars of Clair de lune for the landing page's live score.

Reads the library MusicXML and its analysis from an already-built pages-site/
and writes frontend/assets/clair-excerpt.json: the first bars as MusicXML plus
the notes (pitch, hand, finger, timing) the landing page plays and names.
Nothing is invented here; every value comes from the score or its analysis.

Usage: python3 scripts/build_landing_excerpt.py [bars]   (default 4)
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCORE = ROOT / "pages-site/static/scores/mt_Clair_de_lune_Claude_Debussy_mxl_f4d60f11.musicxml"
ANALYSIS = ROOT / "pages-site/static/analysis/mt_Clair_de_lune_Claude_Debussy_mxl_f4d60f11.json"
OUT = ROOT / "frontend/assets/clair-excerpt.json"

NOTE_KEYS = ("midi", "letter", "hand", "fingering", "offset", "duration")


def main() -> None:
    bars = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    xml = SCORE.read_text(encoding="utf-8")
    head, *measures = re.split(r"(?=<measure[ >])", xml)
    kept = measures[:bars]
    # the last kept measure still carries everything after its closing tag
    kept[-1] = kept[-1].split("</measure>")[0] + "</measure>\n"
    # Two bars a line at every width: drop the edition's own page layout and
    # start a new system at each odd bar after the first.
    kept = [re.sub(r"<print\b[^>]*/>|<print\b.*?</print>", "", m, flags=re.S) for m in kept]
    for i in range(2, len(kept), 2):
        kept[i] = re.sub(r"(<measure[^>]*>)", r'\1\n      <print new-system="yes"/>', kept[i], count=1)
    # titles and credits are drawn by the page, not the engraver
    head = re.sub(r"<credit\b.*?</credit>\s*", "", head, flags=re.S)
    excerpt = head + "".join(kept) + "  </part>\n</score-partwise>\n"

    analysis = json.loads(ANALYSIS.read_text(encoding="utf-8"))
    debriefs = {}
    for n in range(1, bars + 1):
        d = analysis["debriefs"].get(str(n)) or {}
        debriefs[str(n)] = {
            hand: [{k: note.get(k) for k in NOTE_KEYS} for note in d.get(hand) or []]
            for hand in ("rh", "lh")
        }
        debriefs[str(n)]["headline"] = d.get("headline") or ""
        debriefs[str(n)]["focus"] = d.get("focus") or ""

    m = re.search(r"(\d+)\s*bpm", str(analysis.get("tempo") or ""))
    payload = {
        "id": "debussy-clair-de-lune",
        "title": "Clair de lune",
        "composer": "Claude Debussy",
        "bars": bars,
        "bpm": int(m.group(1)) if m else 50,
        "timeSignature": analysis.get("timeSignature") or "9/8",
        "credit": analysis.get("credit") or {},
        "debriefs": debriefs,
        "musicxml": excerpt,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {bars} bars, {OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
