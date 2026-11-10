#!/usr/bin/env python3
"""Add the ASAP piano scores to Lune's fetch-on-open catalogue.

ASAP (https://github.com/fosfrancesco/asap-dataset) holds MusicXML for 235
movements of the standard piano repertoire, under CC BY-NC-SA 4.0. Lune only
lists them: a score is fetched from GitHub when someone opens it, credited
under the page, and analysed in the browser like any other piece.

    gh api "repos/fosfrancesco/asap-dataset/git/trees/master?recursive=1" > /tmp/asap.json
    python3 scripts/add_asap_catalog.py /tmp/asap.json
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = "https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/"
CREDIT = {
    "source": "ASAP dataset (Foscarin et al.)",
    "sourceUrl": "https://github.com/fosfrancesco/asap-dataset",
    "license": "CC BY-NC-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
}
COMPOSERS = {
    "Bach": ("Johann Sebastian Bach", "Baroque"),
    "Balakirev": ("Mily Balakirev", "Romantic"),
    "Beethoven": ("Ludwig van Beethoven", "Classical"),
    "Brahms": ("Johannes Brahms", "Romantic"),
    "Chopin": ("Frédéric Chopin", "Romantic"),
    "Debussy": ("Claude Debussy", "Impressionist"),
    "Glinka": ("Mikhail Glinka", "Romantic"),
    "Haydn": ("Joseph Haydn", "Classical"),
    "Liszt": ("Franz Liszt", "Romantic"),
    "Mozart": ("Wolfgang Amadeus Mozart", "Classical"),
    "Prokofiev": ("Sergei Prokofiev", "Modern"),
    "Rachmaninoff": ("Sergei Rachmaninoff", "Late Romantic"),
    "Ravel": ("Maurice Ravel", "Impressionist"),
    "Schubert": ("Franz Schubert", "Romantic"),
    "Schumann": ("Robert Schumann", "Romantic"),
    "Scriabin": ("Alexander Scriabin", "Late Romantic"),
}


def words(seg: str) -> str:
    s = seg.replace("_", " ").strip()
    s = re.sub(r"\bop (\d+)", r"Op. \1", s, flags=re.I)
    s = re.sub(r"\bbwv (\d+)", r"BWV \1", s, flags=re.I)
    s = re.sub(r"\bno (\d+)", r"No. \1", s, flags=re.I)
    return s[:1].upper() + s[1:]


def title_for(parts: list[str]) -> str:
    """Folder names → a readable title. Nothing is added that the path doesn't say."""
    work, rest = parts[0], parts[1:]
    singular = re.sub(r"^Piano_Sonatas$", "Piano Sonata", work)
    singular = re.sub(r"s$", "", singular) if work in ("Ballades", "Scherzos", "Polonaises", "Impromptus") else singular
    base = words(singular)
    if not rest:
        return base
    tail = rest[0]
    m = re.fullmatch(r"(\d+)-(\d+)(?:_.*)?", tail)
    if m:  # sonata number (or Deutsch / Hoboken number) and movement
        # The folder gives one number (a sonata number, an opus or a catalogue
        # number, depending on the composer). It is shown as given, not labelled.
        return f"{base} {int(m.group(1))}, movement {m.group(2)}"
    if re.fullmatch(r"\d+", tail):
        return f"{base} {int(tail)}"
    if re.fullmatch(r"bwv_\d+", tail, flags=re.I):
        return f"{base}, {words(tail)}"
    return f"{base}: {words(' '.join(rest))}"


def norm(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def main(tree_path: str) -> None:
    tree = json.loads(Path(tree_path).read_text())["tree"]
    paths = sorted(t["path"] for t in tree if t["path"].endswith("xml_score.musicxml"))
    items = []
    for p in paths:
        segs = p.split("/")[:-1]
        if segs[0] not in COMPOSERS or len(segs) < 2:
            continue
        composer, era = COMPOSERS[segs[0]]
        title = title_for(segs[1:])
        ident = "asap-" + re.sub(r"[^a-z0-9]+", "-", norm(f"{segs[0]} {' '.join(segs[1:])}")).strip("-")
        items.append(
            {
                "id": ident,
                "title": title,
                "composer": composer,
                "query": norm(f"{composer} {title}"),
                "hay": norm(f"{title} {composer} {segs[0]} {' '.join(segs[1:])} piano {era}"),
                "group": segs[0],
                "epoch": era,
                "era": era,
                "source": "asap",
                "format": "musicxml",
                "url": RAW + p,
                "credit": CREDIT,
                "openable": True,
                "remote": True,
            }
        )

    cat_path = ROOT / "frontend" / "remote-catalog.json"
    cat = json.loads(cat_path.read_text())
    cat["items"] = [i for i in cat["items"] if i.get("source") != "asap"] + items
    cat["count"] = len(cat["items"])
    cat.setdefault("credits", {})["asap"] = CREDIT
    cat_path.write_text(json.dumps(cat, ensure_ascii=False))

    idx_path = ROOT / "frontend" / "search-index.json"
    idx = json.loads(idx_path.read_text())
    keep = [i for i in idx["items"] if i.get("source") != "asap"]
    idx["items"] = keep + [
        {k: i[k] for k in ("id", "title", "composer", "query", "group", "hay", "epoch", "era", "openable", "remote", "source")} for i in items
    ]
    idx["count"] = len(idx["items"])
    idx["remote"] = sum(1 for i in idx["items"] if i.get("remote"))
    idx_path.write_text(json.dumps(idx, ensure_ascii=False))
    print(f"{len(items)} ASAP scores listed; catalogue {cat['count']}, search index {idx['count']}")
    for i in items[::40]:
        print("  ", i["composer"], "—", i["title"])


if __name__ == "__main__":
    main(sys.argv[1])
