#!/usr/bin/env python3
"""Braille music for the piano pieces Lune fetches on open (remote-catalog.json).

The bundled library already has braille from scripts/braille_export.py. This
does the same for the remote piano sources (ASAP, MuseTrainer, DCML Mozart):
it downloads each MusicXML from its allowlisted GitHub address, translates it
with music21, and adds it to <site>/static/braille/index.json. Song and
quartet scores (OpenScore Lieder, String Quartets) are left out: they are not
piano solo.

    python3 scripts/braille_remote.py <site-dir>      (e.g. pages-site)
"""
from __future__ import annotations

import io
import json
import signal
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from braille_export import Timeout, _alarm, ascii_text, simplify, to_brf, wrap40  # noqa: E402
from music21 import converter, metadata  # noqa: E402
from music21.braille import translate  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
PIANO_SOURCES = {"asap", "musetrainer", "dcml-mozart"}
NOTE = "Braille music made automatically with music21 — check with a braille music reader before relying on it."


def fetch(url: str) -> Path:
    data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Lune braille (+https://lune.page)"}), timeout=60).read()
    suffix = ".mxl" if url.endswith(".mxl") or data[:2] == b"PK" else ".musicxml"
    f = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    f.write(data)
    f.close()
    return Path(f.name)


def main(site: Path) -> None:
    catalog = json.loads((ROOT / "frontend" / "remote-catalog.json").read_text(encoding="utf-8"))
    out_dir = site / "static" / "braille"
    index_path = out_dir / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    todo = [x for x in catalog["items"] if x.get("source") in PIANO_SOURCES and x["id"] not in index]
    print(f"{len(todo)} remote piano pieces without braille", flush=True)
    signal.signal(signal.SIGALRM, _alarm)
    made, skipped = 0, []
    for i, row in enumerate(todo, 1):
        try:
            src = fetch(row["url"])
            signal.alarm(120)
            score = converter.parse(str(src))
            score.metadata = metadata.Metadata()
            score.metadata.title = ascii_text(row["title"])[:60]
            score.metadata.composer = ascii_text(row.get("composer", ""))[:40]
            try:
                text = translate.objectToBraille(score, maxLineLength=40)
            except Exception:  # noqa: BLE001
                simplify(score)
                text = translate.objectToBraille(score, maxLineLength=40)
            signal.alarm(0)
        except (Exception, Timeout) as err:  # noqa: BLE001
            signal.alarm(0)
            skipped.append((row["id"], type(err).__name__, str(err)[:80]))
            print(f"[{i}/{len(todo)}] skip {row['id']}: {type(err).__name__}", flush=True)
            continue
        text = wrap40(text)
        (out_dir / f"{row['id']}.brf").write_text(to_brf(text), encoding="ascii")
        (out_dir / f"{row['id']}.txt").write_text(text, encoding="utf-8")
        index[row["id"]] = {"file": f"{row['id']}.brf", "text": f"{row['id']}.txt", "lines": text.count("\n") + 1, "note": NOTE}
        made += 1
        if made % 10 == 0:
            index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"[{i}/{len(todo)}] ok {row['id']}", flush=True)
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"made {made}, skipped {len(skipped)}; index now {len(index)} pieces")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "pages-site"))
