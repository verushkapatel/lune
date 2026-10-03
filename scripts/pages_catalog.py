#!/usr/bin/env python3
"""Curated catalogue for the static (GitHub Pages) site.

The search index used to list ~1,200 titles and resolve each one to the
"nearest" score on disk, so most searches opened a different piece. The public
site now lists only scores that are really there, once each, with a correct
title, search aliases and a source credit.

Usage (after scripts/export_pages.py, or on an existing Pages checkout):

    python3 scripts/pages_catalog.py /path/to/site [--reanalyze]

--reanalyze re-runs the Python analysis for every included score so letters,
fingerings and bar advice match the current engine.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CC_BY_NC_SA = ("CC BY-NC-SA 4.0", "https://creativecommons.org/licenses/by-nc-sa/4.0/")

SAPP = "Humdrum edition by Craig Stuart Sapp"
MUSETRAINER = ("MuseTrainer public-domain MusicXML library", "https://github.com/musetrainer/library")
M21 = ("music21 corpus", "https://github.com/cuthbertLab/music21")


def sapp(repo: str, license_=None, year=""):
    return {
        "source": f"{SAPP}{(' (' + year + ')') if year else ''}",
        "sourceUrl": f"https://github.com/craigsapp/{repo}",
        "license": license_[0] if license_ else "",
        "licenseUrl": license_[1] if license_ else "",
    }


# file-stem prefix → catalogue entry. Order = display order inside a composer.
# "skip": not piano music, or a duplicate of a better copy of the same piece.
CATALOG = [
    # --- Bach ---
    ("bach_prelude_c", dict(id="bach-wtc1-prelude-c", title="WTC I — Prelude in C major, BWV 846", composer="Johann Sebastian Bach",
                            aliases="well tempered clavier prelude c major bwv 846 wtc", source="Lune sample library (via music21)", sourceUrl="https://github.com/cuthbertLab/music21")),
    ("bach_wtc1f02", dict(id="bach-wtc1-fugue-c-minor", title="WTC I — Fugue in C minor, BWV 847", composer="Johann Sebastian Bach",
                          aliases="well tempered clavier fugue c minor bwv 847 wtc", source="Humdrum encoding by David Huron (1994), via music21", sourceUrl="https://github.com/cuthbertLab/music21")),
    ("bach_inven01", dict(id="bach-invention-1", title="Invention no. 1 in C major, BWV 772", composer="Johann Sebastian Bach",
                          aliases="two part invention 1 bwv 772", source="Humdrum encoding by David Huron (1994), via music21", sourceUrl="https://github.com/cuthbertLab/music21")),
    ("mt_Minuet_in_G_Major_Bach", dict(id="bach-minuet-g", title="Minuet in G major, BWV Anh. 114", composer="Johann Sebastian Bach",
                                       aliases="minuet in g anna magdalena notebook petzold bwv anh 114", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("bach_chorale001", dict(id="bach-chorale-1", title="Chorale no. 1", composer="Johann Sebastian Bach",
                             aliases="chorale 371 chorales four part", source=M21[0], sourceUrl=M21[1])),
    ("bach_chorale040", dict(id="bach-chorale-40", title="Chorale no. 40", composer="Johann Sebastian Bach",
                             aliases="chorale 371 chorales four part", source=M21[0], sourceUrl=M21[1])),
    # --- Scarlatti / Haydn / Mozart / Clementi ---
    ("scarlatti_L366K001", dict(id="scarlatti-k1", title="Keyboard Sonata in D minor, K. 1 (L. 366)", composer="Domenico Scarlatti",
                                aliases="sonata k1 l366 kk 1", **sapp("scarlatti-keyboard-sonatas", CC_BY_NC_SA, "2021"))),
    ("haydn_sonata62-1", dict(id="haydn-sonata-62-1", title="Piano Sonata no. 62 in E-flat major, Hob. XVI:52 — Movement 1", composer="Joseph Haydn",
                              aliases="sonata 62 hob xvi 52 e flat", **sapp("haydn-piano-sonatas", CC_BY_NC_SA, "2021"))),
    ("mozart_-_sonata_no._16_mvt._1", dict(id="mozart-k545-1", title="Piano Sonata no. 16 in C major, K. 545 — Movement 1", composer="Wolfgang Amadeus Mozart",
                                           aliases="sonata facile k545 k 545 allegro sonata semplice", source="MuseScore user upload (classicman)", sourceUrl="https://musescore.com/classicman/scores/77457")),
    ("mozart_-_sonata_no._16_mvt._2", dict(id="mozart-k545-2", title="Piano Sonata no. 16 in C major, K. 545 — Movement 2", composer="Wolfgang Amadeus Mozart",
                                           aliases="sonata facile k545 k 545 andante", source="MuseScore user upload (classicman)", sourceUrl="https://musescore.com/classicman/scores/74298")),
    ("mozart_-_sonata_no._16_mvt._3", dict(id="mozart-k545-3", title="Piano Sonata no. 16 in C major, K. 545 — Movement 3", composer="Wolfgang Amadeus Mozart",
                                           aliases="sonata facile k545 k 545 rondo", source="MuseScore user upload", sourceUrl="https://musescore.com/score/77619")),
    ("mozart_sonata16-1", None),  # duplicate of the K.545 first movement above
    ("clementi_-_sonatinas", dict(id="clementi-sonatinas-op36", title="Sonatinas, op. 36", composer="Muzio Clementi",
                                  aliases="sonatina op 36 clementi", source="MuseScore user upload (public domain)", sourceUrl="https://musescore.com/user/9292486/scores/5314825", license="Public domain")),
    # --- Beethoven ---
    ("beethoven_-_bagatelle_no._25_fur_elise", dict(id="beethoven-fur-elise", title="Bagatelle no. 25 in A minor, WoO 59 “Für Elise”", composer="Ludwig van Beethoven",
                                                    aliases="fur elise für elise fuer elise elise bagatelle woo 59", source="OpenScore", sourceUrl="https://musescore.com/score/4053926", license="CC0", licenseUrl="https://creativecommons.org/publicdomain/zero/1.0/")),
    ("beethoven_moonlight_mvt1", dict(id="beethoven-moonlight-1", title="Piano Sonata no. 14 “Moonlight” — Movement 1", composer="Ludwig van Beethoven",
                                      aliases="moonlight sonata op 27 no 2 c sharp minor adagio sostenuto mondschein", source="Lune sample library (via music21)", sourceUrl="https://github.com/cuthbertLab/music21")),
    ("beethoven_sonata14-1", None),  # duplicate of the Moonlight first movement above
    ("beethoven_sonata14-2", dict(id="beethoven-moonlight-2", title="Piano Sonata no. 14 “Moonlight” — Movement 2", composer="Ludwig van Beethoven",
                                  aliases="moonlight sonata op 27 no 2 allegretto", **sapp("beethoven-piano-sonatas"))),
    ("beethoven_sonata08-1", dict(id="beethoven-pathetique-1", title="Piano Sonata no. 8 “Pathétique” — Movement 1", composer="Ludwig van Beethoven",
                                  aliases="pathetique sonata op 13 grave allegro", **sapp("beethoven-piano-sonatas"))),
    ("beethoven_sonata01-1", dict(id="beethoven-sonata-1-1", title="Piano Sonata no. 1 in F minor — Movement 1", composer="Ludwig van Beethoven",
                                  aliases="sonata op 2 no 1 f minor", **sapp("beethoven-piano-sonatas"))),
    ("beethoven_op18_1_m1", None),  # string quartet, not piano
    # --- Chopin ---
    ("mt_Chopin_Nocturne_Op_9_No_2", dict(id="chopin-nocturne-9-2", title="Nocturne op. 9 no. 2 in E-flat major", composer="Frédéric Chopin",
                                          aliases="nocturne op 9 2 e flat", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("mt_Chopin_Nocturne_Op_9_No_1", dict(id="chopin-nocturne-9-1", title="Nocturne op. 9 no. 1 in B-flat minor", composer="Frédéric Chopin",
                                          aliases="nocturne op 9 1 b flat minor", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("mt_Nocturne_No_20", dict(id="chopin-nocturne-20", title="Nocturne no. 20 in C-sharp minor, op. posth.", composer="Frédéric Chopin",
                               aliases="nocturne 20 c sharp minor posthumous lento con gran espressione", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("chopin_prelude28-15", dict(id="chopin-prelude-28-15", title="Prelude op. 28 no. 15 “Raindrop”", composer="Frédéric Chopin",
                                 aliases="raindrop prelude op 28 15 d flat", **sapp("chopin-preludes", None, "2008"))),
    ("chopin_prelude28-01", dict(id="chopin-prelude-28-1", title="Prelude op. 28 no. 1 in C major", composer="Frédéric Chopin",
                                 aliases="prelude op 28 1", **sapp("chopin-preludes", None, "2008"))),
    ("chopin_prelude28-02", dict(id="chopin-prelude-28-2", title="Prelude op. 28 no. 2 in A minor", composer="Frédéric Chopin",
                                 aliases="prelude op 28 2", **sapp("chopin-preludes", None, "2001"))),
    ("chopin_mazurka06-1", dict(id="chopin-mazurka-6-1", title="Mazurka op. 6 no. 1 in F-sharp minor", composer="Frédéric Chopin",
                                aliases="mazurka op 6 1", **sapp("chopin-mazurkas"))),
    ("chopin_mazurka_", dict(id="chopin-mazurka-6-2", title="Mazurka op. 6 no. 2 in C-sharp minor", composer="Frédéric Chopin",
                             aliases="mazurka op 6 2", source="Lune sample library (via music21)", sourceUrl="https://github.com/cuthbertLab/music21")),
    ("chopin_mazurka06-2", None),  # duplicate of op. 6 no. 2 above
    # --- Liszt / Debussy / Satie / Scriabin / Joplin ---
    ("mt_Liebestraum_No_3", dict(id="liszt-liebestraum-3", title="Liebestraum no. 3 in A-flat major, S. 541", composer="Franz Liszt",
                                 aliases="liebestraum liebestraume love dream no 3", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("mt_La_Campanella", dict(id="liszt-la-campanella", title="Grandes études de Paganini no. 3 “La Campanella”", composer="Franz Liszt",
                              aliases="la campanella campanella paganini etude", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("mt_Clair_de_lune", dict(id="debussy-clair-de-lune", title="Suite bergamasque — Clair de lune", composer="Claude Debussy",
                              aliases="clair de lune claire de lune moonlight suite bergamasque", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("mt_Erik_Satie_Gymnopedie", dict(id="satie-gymnopedie-1", title="Gymnopédie no. 1", composer="Erik Satie",
                                      aliases="gymnopedie gymnopédie 1", source=MUSETRAINER[0], sourceUrl=MUSETRAINER[1])),
    ("scriabin_op10_scriabin_op10_no01", dict(id="scriabin-impromptu-10-1", title="Impromptu op. 10 no. 1 in F-sharp minor", composer="Alexander Scriabin",
                                              aliases="impromptu a la mazur op 10 1", **sapp("scriabin-op10"))),
    ("scriabin_op11_scriabin_op11_no01", dict(id="scriabin-prelude-11-1", title="Prelude op. 11 no. 1 in C major", composer="Alexander Scriabin",
                                              aliases="prelude op 11 1", **sapp("scriabin-op11"))),
    ("scriabin_op11_scriabin_op11_no10", dict(id="scriabin-prelude-11-10", title="Prelude op. 11 no. 10 in C-sharp minor", composer="Alexander Scriabin",
                                              aliases="prelude op 11 10", **sapp("scriabin-op11"))),
    ("joplin_entertainer", dict(id="joplin-entertainer", title="The Entertainer", composer="Scott Joplin",
                                aliases="entertainer rag ragtime sting", **sapp("joplin", CC_BY_NC_SA, "2021"))),
    ("joplin_mapleleaf", dict(id="joplin-maple-leaf", title="Maple Leaf Rag", composer="Scott Joplin",
                              aliases="maple leaf rag ragtime", **sapp("joplin", None, "2004"))),
    ("twinkle", dict(id="twinkle", title="Twinkle, Twinkle, Little Star", composer="Traditional",
                     aliases="twinkle twinkle little star ah vous dirai je maman beginner", source="Lune sample library", sourceUrl="")),
    # not piano music
    ("mozart_k155_m1", None),
    ("schumann_dichterliebe2", None),
    ("corpus_", None),
]

GROUP_BY_COMPOSER = {
    "Johann Sebastian Bach": "Bach",
    "Domenico Scarlatti": "Scarlatti",
    "Joseph Haydn": "Haydn",
    "Wolfgang Amadeus Mozart": "Mozart",
    "Muzio Clementi": "Clementi",
    "Ludwig van Beethoven": "Beethoven",
    "Frédéric Chopin": "Chopin",
    "Franz Liszt": "Liszt",
    "Claude Debussy": "Debussy",
    "Erik Satie": "Satie",
    "Alexander Scriabin": "Scriabin",
    "Scott Joplin": "Joplin",
    "Traditional": "Traditional",
}


def norm(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


def match_entry(file_stem: str):
    for prefix, entry in CATALOG:
        if file_stem.startswith(prefix):
            return prefix, entry
    return None, None


def build(site: Path, reanalyze: bool = False) -> None:
    static = site / "static"
    old_opens = json.loads((static / "opens.json").read_text(encoding="utf-8"))
    by_file = {}
    for row in old_opens:
        by_file.setdefault(row["file"], row)

    if reanalyze:
        os.environ.setdefault("LUNE_CACHE_DIR", "/tmp/lune-pages-analysis")
        from backend.main import _piece_from_path_cached  # noqa: E402
    from backend.discover import piece_overview  # noqa: E402

    entries = []
    unmatched = []
    keep_files = set()
    for xml in sorted((static / "scores").glob("*.musicxml")):
        stem = xml.stem
        prefix, entry = match_entry(stem)
        if prefix is None:
            unmatched.append(stem)
            continue
        if entry is None:
            continue
        file_rel = f"scores/{xml.name}"
        analysis_rel = f"analysis/{stem}.json"
        old = by_file.get(file_rel) or {}
        if reanalyze:
            payload = _piece_from_path_cached(
                xml, filename=xml.name, meta={"title": entry["title"], "composer": entry["composer"]}
            )
            payload.pop("musicxml", None)
            payload.pop("dataUrl", None)
        else:
            payload = json.loads((static / analysis_rel).read_text(encoding="utf-8"))
        payload["title"] = entry["title"]
        payload["composer"] = entry["composer"]
        overview = piece_overview(entry["title"], entry["composer"], payload, remote=False)
        payload["overview"] = overview
        credit = {
            "source": entry.get("source", ""),
            "sourceUrl": entry.get("sourceUrl", ""),
            "license": entry.get("license", ""),
            "licenseUrl": entry.get("licenseUrl", ""),
        }
        payload["credit"] = credit
        (static / analysis_rel).write_text(json.dumps(payload), encoding="utf-8")
        keep_files.add(xml.name)
        keep_files.add(f"{stem}.json")
        download = re.sub(r"[^A-Za-z0-9._-]+", "_", norm(entry["title"])).strip("_")[:80] or "score"
        hay = norm(" ".join([entry["title"], entry["composer"], entry.get("aliases", ""), GROUP_BY_COMPOSER.get(entry["composer"], "")]))
        entries.append(
            {
                "id": entry["id"],
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["id"],
                "group": GROUP_BY_COMPOSER.get(entry["composer"], entry["composer"]),
                "hay": hay,
                "epoch": overview.get("epoch") or overview.get("era") or old.get("epoch") or "",
                "file": file_rel,
                "analysis": analysis_rel,
                "source": "library",
                "overview": overview,
                "credit": credit,
                "downloadName": f"{download}.musicxml",
                "fallbackNote": "",
            }
        )

    if unmatched:
        print("WARNING: scores with no catalogue entry (left out):", *unmatched, sep="\n  ")

    ids = [e["id"] for e in entries]
    assert len(ids) == len(set(ids)), "duplicate catalogue ids"

    # Drop files the catalogue does not list (duplicates, non-piano works).
    for folder in ("scores", "analysis"):
        for f in (static / folder).iterdir():
            if f.name not in keep_files:
                f.unlink()

    (static / "opens.json").write_text(json.dumps(entries), encoding="utf-8")
    index_items = [
        {k: e[k] for k in ("id", "title", "composer", "query", "group", "hay")} for e in entries
    ]
    (static / "search-index.json").write_text(
        json.dumps({"items": index_items, "count": len(index_items), "curated": True}), encoding="utf-8"
    )
    print(f"catalogue: {len(entries)} pieces")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    build(Path(args[0] if args else os.environ.get("LUNE_PAGES_DIR") or "/tmp/lune-pages"), reanalyze="--reanalyze" in sys.argv)
