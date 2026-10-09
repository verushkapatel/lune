#!/usr/bin/env python3
"""Build frontend/library-index.json from the PDMX batch results.

Usage: python3 scripts/pdmx_index.py <results.jsonl> <cands-meta.json> <out.json> <pd-who.json>
Each item: [id, title, composer, "", era, weight]; the file path follows from
the id (scores/<two letters>/<id>.mxl on the "library" branch).
"""
import json
import math
import re
import sys

res, meta_path, out, who_path = sys.argv[1:5]
# optional: scripts/pdmx_check.py results; a score that does not render is left out
checked = json.load(open(sys.argv[5])) if len(sys.argv) > 5 else None
meta = json.load(open(meta_path))
# only music that is really in the public domain (scripts/pd_composers.py):
# an uploader's licence cannot free a copyrighted song
who = json.load(open(who_path))
sys.path.insert(0, "scripts")
from pd_composers import PD  # noqa: E402
# eras from Lune's own index, by composer surname
eras = {}
for e in json.load(open("frontend/search-index.json"))["items"]:
    c = (e.get("composer") or "").strip()
    if c and e.get("epoch"):
        eras.setdefault(c.split()[-1].lower(), e["epoch"])


def mend(t):
    # text that was UTF-8 read as Latin-1 (A♭ shown as "Aâ")
    if "â" in t or "Ã" in t:
        try:
            return t.encode("latin-1").decode("utf-8")
        except (UnicodeError, ValueError):
            # the accidental's bytes are lost upstream: ♭ or ♯ cannot be told
            # apart, so the key is left out rather than guessed
            t = re.sub(r"\s*\bin\s+[A-G]â\s*(major|minor|maj|min)\b", "", t, flags=re.I)
            t = re.sub(r"[A-G]â\s*(major|minor)\b\s*", "", t, flags=re.I)
            return re.sub(r"[âÃ][\x80-\xbf]*", "", t).strip()
    return t


def clean_title(t, composer):
    t = mend(re.sub(r"\s+", " ", str(t or "")).strip())
    if composer:
        last = re.escape(composer.split()[-1])
        # "Title - Wm. J. Kirkpatrick", "Title by J. S. Bach": the composer's part goes
        t = re.sub(rf"\s*(?:[-–—|/]|\bby\b)\s*[^-–—|/]*\b{last}\b[^-–—|/]*$", "", t, flags=re.I) or t
        for c in (composer, composer.split()[-1]):
            t = re.sub(rf"\s*([-–—|/,]|\bby\b)?\s*{re.escape(c)}\s*$", "", t, flags=re.I)
    return t[:110] or "Untitled"


items = []
seen = set()
for line in open(res):
    r = json.loads(line)
    if not r.get("ok") or (checked is not None and checked.get(r["id"]) != "ok"):
        continue
    m = meta.get(r["src"][5:]) or {}
    w_ = who.get(r["src"][5:])
    if not w_:
        continue
    composer = mend(re.sub(r"\s+", " ", (m.get("composer") or "")).strip()[:70])
    canon = PD.get(w_) if w_ not in ("trad", "hymnal") else None
    if canon and not composer:
        composer = canon[0]
    if w_ == "trad" and (not composer or re.fullmatch(r"(misc\.?\s*)?(trad\.?|traditional|tradicional|traditionnel|anonymous|anon\.?)", composer.strip(), re.I)):
        composer = "Traditional"
    # an era only when the composer field names that composer (James Scott, not James Scott Skinner)
    if canon and composer and composer != canon[0]:
        last = canon[0].split()[-1].lower()
        if last not in composer.lower() or re.search(rf"{re.escape(last)}\s+\w", composer.lower().split(last, 1)[0] + last + composer.lower().split(last, 1)[-1][:0]) is None and composer.lower().strip().split()[-1] != last:
            canon = None
    title = clean_title(m.get("title") or m.get("song"), composer)
    # 20th-century songs often passed off as folk songs: still in copyright
    if re.search(r"katyusha|katjuscha|katioucha|moscow nights|podmoskovn|polyushko|polyushka|smuglyanka|those were the days|cossack patrol|l.?internationale|kalinka mallinka", title + " " + composer, re.I):
        continue
    key = (title.lower(), composer.lower())
    if key in seen:
        continue
    seen.add(key)
    era = (canon[1] if canon else "") or (eras.get(composer.split()[-1].lower(), "") if composer else "")
    w = round(math.log10(1 + m.get("views", 0)) * 10 + m.get("rating", 0) * 3 + math.log10(1 + m.get("nr", 0)) * 4)
    items.append([r["id"], title, composer, "", era, w])
items.sort(key=lambda x: -x[5])
doc = {
    "version": 1,
    "base": "https://raw.githubusercontent.com/verushkapatel/lune/library/scores/",
    "allowlistHosts": ["raw.githubusercontent.com"],
    "credit": {
        "source": "PDMX: public-domain and CC0 scores shared on MuseScore (Long et al., 2024), written as MusicXML by Lune",
        "sourceUrl": "https://github.com/pnlong/PDMX",
        "license": "Public domain or CC0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "count": len(items),
    "items": items,
}
json.dump(doc, open(out, "w"), ensure_ascii=False, separators=(",", ":"))
print(len(items), "pieces")
