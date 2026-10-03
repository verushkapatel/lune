"""Second pass for pieces scripts/braille_export.py could not translate.

music21's braille translator stops when it cannot place a word or a line
(tempo text, dynamics, hairpins, slurs across voices). This pass removes
those markings and translates the notes, rhythms, key and time signatures
alone, so the piece still gets a braille file. The index says when a file
was made this way.

    python3 scripts/braille_retry.py [site-dir]
"""
from __future__ import annotations

import json
import signal
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from braille_export import Timeout, _alarm, ascii_text, to_brf, wrap40  # noqa: E402

from music21 import converter, dynamics, expressions, metadata, spanner, tempo  # noqa: E402
from music21.braille import translate  # noqa: E402


def strip_markings(score) -> None:
    for sp in list(score.recurse().getElementsByClass(spanner.Spanner)):
        if sp.activeSite is not None:
            sp.activeSite.remove(sp)
    kinds = (expressions.Expression, dynamics.Dynamic, tempo.TempoIndication, expressions.TextExpression)
    for el in list(score.recurse().getElementsByClass(kinds)):
        if el.activeSite is not None:
            el.activeSite.remove(el)
    for n in score.recurse().notesAndRests:
        n.articulations = []
        n.expressions = []
        if hasattr(n, "lyrics"):
            n.lyrics = []


def main(site: Path) -> None:
    static = site / "static"
    out_dir = static / "braille"
    index = json.loads((out_dir / "index.json").read_text())
    opens = json.loads((static / "opens.json").read_text())
    signal.signal(signal.SIGALRM, _alarm)
    made = 0
    for row in opens:
        if row["id"] in index:
            continue
        src = static / row["file"]
        if not src.exists():
            src = static / "scores" / Path(row["file"]).name
        try:
            signal.alarm(120)
            score = converter.parse(str(src))
            strip_markings(score)
            score.metadata = metadata.Metadata()
            score.metadata.title = ascii_text(row["title"])[:60]
            score.metadata.composer = ascii_text(row.get("composer", ""))[:40]
            text = translate.objectToBraille(score, maxLineLength=40)
            signal.alarm(0)
        except (Exception, Timeout) as err:  # noqa: BLE001
            signal.alarm(0)
            print("skip", row["id"], type(err).__name__, str(err)[:60], flush=True)
            continue
        text = wrap40(text)
        (out_dir / f"{row['id']}.brf").write_text(to_brf(text), encoding="ascii")
        (out_dir / f"{row['id']}.txt").write_text(text, encoding="utf-8")
        index[row["id"]] = {
            "file": f"{row['id']}.brf",
            "text": f"{row['id']}.txt",
            "lines": text.count("\n") + 1,
            "plain": True,
            "note": "Braille music made automatically with music21: notes and rhythm only, without dynamics, slurs or text. Check with a braille music reader before relying on it.",
        }
        made += 1
        print("ok  ", row["id"], flush=True)
        (out_dir / "index.json").write_text(json.dumps(index, indent=1))
    print(f"\n{made} more braille files, {len(index)} in all")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "pages-site"))
