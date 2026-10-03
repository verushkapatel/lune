#!/usr/bin/env python3
"""Add Mozart's Piano Sonata no. 18, K. 576, to the fetch-on-open catalogue.

Source: The Annotated Mozart Sonatas (DCML corpus: Hentschel, Neuwirth and
Rohrmeier), licensed CC BY-NC-SA 4.0, as MusicXML in the When in Rome corpus
(Gotham et al.), which converts the DCML MuseScore files. Lune is free and
non-commercial and serves the files unchanged from GitHub, with credit.

Only K. 576 is added: Lune already ships sonatas 1 to 17 from another
edition. Titles are read from each file's work-title and movement-title, and
the Köchel number from When in Rome's remote.json; nothing is made up.

Usage: python3 scripts/add_dcml_mozart.py   (rewrites frontend/remote-catalog.json
and frontend/search-index.json; running it twice changes nothing)
"""
import io
import json
import re
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REMOTE = ROOT / "frontend" / "remote-catalog.json"
INDEX = ROOT / "frontend" / "search-index.json"
BASE = "https://raw.githubusercontent.com/MarkGotham/When-in-Rome/master/Corpus/Piano_Sonatas/Mozart,_Wolfgang_Amadeus"
CREDIT = {
    "source": "The Annotated Mozart Sonatas (DCML: Hentschel, Neuwirth, Rohrmeier), MusicXML via When in Rome (Gotham et al.)",
    "sourceUrl": "https://github.com/DCMLab/mozart_piano_sonatas",
    "license": "CC BY-NC-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
}
WORKS = [("K576", m) for m in (1, 2, 3)]


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Lune catalogue (+https://lune.page)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def tags(mxl: bytes):
    z = zipfile.ZipFile(io.BytesIO(mxl))
    name = next(n for n in z.namelist() if not n.startswith("META") and n.endswith((".xml", ".musicxml")))
    x = z.read(name).decode("utf-8", "replace")
    one = lambda t: (re.findall(rf"<{t}[^>]*>([^<]*)</{t}>", x) or [""])[0].strip()  # noqa: E731
    return {"work": one("work-title"), "movement": one("movement-title"), "number": one("movement-number"), "creator": one("creator")}


def main():
    remote = json.loads(REMOTE.read_text(encoding="utf-8"))
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    remote["credits"]["dcml-mozart"] = CREDIT
    added = []
    for k, m in WORKS:
        meta = json.loads(fetch(f"{BASE}/{k}/{m}/remote.json"))
        url = f"{BASE}/{k}/{m}/score.mxl"
        t = tags(fetch(url))
        kv = meta["Köchel-Verzeichnis"]
        assert t["creator"] == "Wolfgang Amadeus Mozart" and t["work"] and t["movement"], t
        title = f"{t['work']}, K. {kv} — {t['movement']}"
        rid = f"dcml-mozart-k{kv}-{m}"
        hay = f"{t['work']} k {kv} k{kv} {t['movement']} movement {m} wolfgang amadeus mozart mozart piano sonata classical".lower()
        entry = {
            "id": rid,
            "title": title,
            "composer": "Wolfgang Amadeus Mozart",
            "query": f"wolfgang amadeus mozart piano sonata k {kv} {m}",
            "hay": hay,
            "group": "Mozart",
            "epoch": "Classical",
            "era": "Classical",
            "source": "dcml-mozart",
            "format": "mxl",
            "url": url,
            "credit": CREDIT,
            "openable": True,
            "remote": True,
        }
        remote["items"] = [x for x in remote["items"] if x["id"] != rid] + [entry]
        slim = {k2: entry[k2] for k2 in ("id", "title", "composer", "query", "group", "hay", "epoch", "era", "openable", "remote", "source")}
        index["items"] = [x for x in index["items"] if x.get("id") != rid] + [slim]
        added.append(title)
    remote["count"] = len(remote["items"])
    index["count"] = len(index["items"])
    index["remote"] = sum(1 for x in index["items"] if x.get("remote"))
    # same layout as the files were written in: one line, default separators, UTF-8
    REMOTE.write_text(json.dumps(remote, ensure_ascii=False), encoding="utf-8")
    INDEX.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print("\n".join(added))


if __name__ == "__main__":
    main()
