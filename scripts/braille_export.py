"""Braille music for Lune's catalogue, made with music21's braille translator.

Writes, for each piece that translates:
    <site>/static/braille/<id>.brf   ASCII braille (BRF) for embossers and
                                     refreshable displays, 40 cells per line
    <site>/static/braille/<id>.txt   the same in Unicode braille, for reading
                                     on screen or checking by eye
and <site>/static/braille/index.json, which the app reads to offer the link.

    python3 scripts/braille_export.py <site-dir>      (e.g. pages-site)

music21's translator follows the Music Braille Code but is not a certified
transcriber; pieces it can't handle are skipped and listed.
"""
from __future__ import annotations

import json
import signal
import sys
import unicodedata
from pathlib import Path

from music21 import converter, metadata
from music21.braille import translate

# Unicode braille (dots) → North American Braille ASCII
BRF = " A1B'K2L@CIF/MSP\"E3H9O6R^DJG>NTQ,*5<-U8V.%[$+X!&;:4\\0Z7(_?W]#Y)="


def to_brf(text: str) -> str:
    out = []
    for ch in text:
        code = ord(ch)
        if 0x2800 <= code <= 0x283F:
            out.append(BRF[code - 0x2800])
        elif ch == "\n":
            out.append("\r\n")
        elif ch == " ":
            out.append(" ")
        # cells using dots 7/8 don't exist in 6-dot BRF; drop them
    return "".join(out)


def wrap40(text: str, width: int = 40) -> str:
    """Heading lines (title, composer) can run past 40 cells; music lines
    never do. Break long lines at a space, runovers indented two cells."""
    blank = "\u2800"
    out = []
    for line in text.split("\n"):
        while len(line) > width:
            cut = line.rfind(blank, 0, width + 1)
            if cut <= 2:
                cut = width
            out.append(line[:cut].rstrip(blank))
            line = blank * 2 + line[cut:].lstrip(blank)
        out.append(line)
    return "\n".join(out)


def ascii_text(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return "".join(c if c.isalnum() or c in " ,.-" else " " for c in s).strip()


def simplify(score) -> None:
    from music21 import articulations, expressions, tempo

    for el in list(score.recurse().getElementsByClass((expressions.TextExpression, expressions.RehearsalMark))):
        el.activeSite.remove(el)
    for mm in score.recurse().getElementsByClass(tempo.MetronomeMark):
        mm.text = None
    for el in list(score.recurse().getElementsByClass(tempo.TempoText)):
        el.activeSite.remove(el)
    for n in score.recurse().notes:
        n.articulations = [a for a in n.articulations if not isinstance(a, articulations.Fingering)]
        if hasattr(n, "lyrics"):
            n.lyrics = []


class Timeout(Exception):
    pass


def _alarm(*_):
    raise Timeout()


def main(site: Path) -> None:
    static = site / "static"
    opens = json.loads((static / "opens.json").read_text())
    out_dir = static / "braille"
    out_dir.mkdir(exist_ok=True)
    index, skipped = {}, []
    signal.signal(signal.SIGALRM, _alarm)
    for row in opens:
        src = static / row["file"] if not row["file"].startswith("static/") else site / row["file"]
        if not src.exists():
            src = static / "scores" / Path(row["file"]).name
        try:
            signal.alarm(90)
            score = converter.parse(str(src))
            score.metadata = metadata.Metadata()
            score.metadata.title = ascii_text(row["title"])[:60]
            score.metadata.composer = ascii_text(row.get("composer", ""))[:40]
            try:
                text = translate.objectToBraille(score, maxLineLength=40)
            except Exception:  # noqa: BLE001
                # second try without the words the translator can't place
                # (long tempo text, expressions, editorial fingerings)
                simplify(score)
                text = translate.objectToBraille(score, maxLineLength=40)
            signal.alarm(0)
        except Exception as err:  # noqa: BLE001 — music21 raises many kinds
            signal.alarm(0)
            skipped.append((row["id"], type(err).__name__, str(err)[:80]))
            continue
        text = wrap40(text)
        brf = to_brf(text)
        (out_dir / f"{row['id']}.brf").write_text(brf, encoding="ascii")
        (out_dir / f"{row['id']}.txt").write_text(text, encoding="utf-8")
        index[row["id"]] = {
            "file": f"{row['id']}.brf",
            "text": f"{row['id']}.txt",
            "lines": text.count("\n") + 1,
            "note": "Braille music made automatically with music21 — check with a braille music reader before relying on it.",
        }
        print(f"ok   {row['id']}  ({index[row['id']]['lines']} lines)")
    (out_dir / "index.json").write_text(json.dumps(index, indent=1))
    for s in skipped:
        print("skip", *s)
    print(f"\n{len(index)} braille files, {len(skipped)} skipped")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "pages-site"))
