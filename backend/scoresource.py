"""Resolve a searched work to an actual MusicXML score and open it.

Sources (all public-domain / openly licensed encodings):
1. Local library shipped with Lune
2. craigsapp Humdrum editions on GitHub → convert with music21
3. music21 corpus on disk
4. musetrainer/library + OpenScore Lieder (raw GitHub MusicXML/MXL)
5. KernScores Liszt encodings (when the mirror is reachable)

We never scrape commercial / copyrighted sheet-music sites.
"""

from __future__ import annotations

import re
import tempfile
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from music21 import converter, corpus

from backend.free_catalogues import (
    KERNSCORES_LISZT,
    KERNSCORES_LISZT_INDEX,
    MUSETAINER_BASE,
    MUSETAINER_INDEX,
    OPENSCORE_BASE,
    OPENSCORE_INDEX,
    SCRIABIN_BASE,
    SCRIABIN_KERNS,
    scriabin_title,
)

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "samples" / "library"
CACHE = Path.home() / "Library" / "Application Support" / "Lune" / "score-cache"
USER_AGENT = "LuneScoreCoach/6.0 (local music practice app)"

LIBRARY_INDEX: List[Dict[str, Any]] = [
    {
        "file": "beethoven_moonlight_mvt1.musicxml",
        "title": 'Piano Sonata no. 14 in C-sharp minor, op. 27 no. 2, "Moonlight"',
        "composer": "Ludwig van Beethoven",
        "keys": ["moonlight", "sonata 14", "sonata no 14", "op 27 no 2", "opus 27 no 2"],
    },
    {
        "file": "beethoven_-_bagatelle_no._25_fur_elise.musicxml",
        "title": 'Bagatelle no. 25 in A minor, WoO 59 "Für Elise"',
        "composer": "Ludwig van Beethoven",
        "keys": ["fur elise", "für elise", "elise", "woo 59", "bagatelle 25"],
    },
    {
        "file": "bach_prelude_c.musicxml",
        "title": "Prelude in C major, BWV 846",
        "composer": "Johann Sebastian Bach",
        "keys": ["bwv 846", "bwv846", "prelude in c", "well tempered", "wtc"],
    },
    {
        "file": "chopin_mazurka.musicxml",
        "title": "Mazurka op. 6 no. 2",
        "composer": "Frédéric Chopin",
        "keys": ["mazurka 06 2", "mazurka op 6 no 2", "op 6 no 2"],
    },
    {
        "file": "schumann_dichterliebe2.musicxml",
        "title": "Dichterliebe no. 2",
        "composer": "Robert Schumann",
        "keys": ["dichterliebe"],
    },
    {
        "file": "beethoven_op18_1_m1.musicxml",
        "title": "String Quartet op. 18 no. 1 — Movement 1",
        "composer": "Ludwig van Beethoven",
        "keys": ["op 18 no 1", "opus 18 no 1", "string quartet op 18"],
    },
    {
        "file": "mozart_k155_m1.musicxml",
        "title": "String Quartet K.155 — Movement 1",
        "composer": "Wolfgang Amadeus Mozart",
        "keys": ["k 155", "k155", "k.155"],
    },
    {
        "file": "mozart_-_sonata_no._16_mvt._1.musicxml",
        "title": "Piano Sonata no. 16 in C major, K.545 — Movement 1",
        "composer": "Wolfgang Amadeus Mozart",
        "keys": ["k 545", "k545", "sonata facile", "mozart sonata 16"],
    },
    {
        "file": "mozart_-_sonata_no._16_mvt._2.musicxml",
        "title": "Piano Sonata no. 16 in C major, K.545 — Movement 2",
        "composer": "Wolfgang Amadeus Mozart",
        "keys": ["k 545 mvt 2", "sonata 16 movement 2"],
    },
    {
        "file": "mozart_-_sonata_no._16_mvt._3.musicxml",
        "title": "Piano Sonata no. 16 in C major, K.545 — Movement 3",
        "composer": "Wolfgang Amadeus Mozart",
        "keys": ["k 545 mvt 3", "sonata 16 movement 3"],
    },
    {
        "file": "clementi_-_sonatinas.musicxml",
        "title": "Sonatinas (Clementi)",
        "composer": "Muzio Clementi",
        "keys": ["clementi", "sonatina", "sonatinas"],
    },
    {
        "file": "twinkle.musicxml",
        "title": "Twinkle Twinkle Little Star",
        "composer": "Traditional",
        "keys": ["twinkle", "little star", "abc song"],
    },
]

ALIASES: List[Dict[str, Any]] = [
    {
        "keys": ["moonlight"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 14,
    },
    {
        "keys": ["fur elise", "für elise", "elise"],
        "composer": "beethoven",
        "kind": "library",
        "file": "beethoven_-_bagatelle_no._25_fur_elise.musicxml",
    },
    {
        "keys": ["pathétique", "pathetique"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 8,
    },
    {
        "keys": ["appassionata"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 23,
    },
    {
        "keys": ["waldstein"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 21,
    },
    {
        "keys": ["tempest"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 17,
    },
    {
        "keys": ["les adieux", "farewell"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 26,
    },
    {
        "keys": ["hammerklavier"],
        "composer": "beethoven",
        "kind": "beethoven-sonata",
        "number": 29,
    },
    {
        "keys": ["twinkle", "little star"],
        "composer": "traditional",
        "kind": "library",
        "file": "twinkle.musicxml",
    },
    {
        "keys": ["clair de lune"],
        "composer": "debussy",
        "kind": "musetrainer",
        "file": "Clair_de_lune_-_Claude_Debussy.mxl",
    },
    {
        "keys": ["minuto", "minuet in g", "anna magdalena"],
        "composer": "bach",
        "kind": "corpus",
        "queries": ["minuet", "bwv anh", "anna"],
    },
    {
        "keys": ["raindrop"],
        "composer": "chopin",
        "kind": "chopin-prelude",
        "number": 15,
    },
    {
        "keys": ["campanella", "la campanella"],
        "composer": "liszt",
        "kind": "musetrainer",
        "file": "La_Campanella_-_Grandes_Etudes_de_Paganini_No._3_-_Franz_Liszt.mxl",
    },
    {
        "keys": ["liebestraum", "liebestraume"],
        "composer": "liszt",
        "kind": "musetrainer",
        "file": "Liebestraum_No._3_in_A_Major.mxl",
    },
    {
        "keys": ["gymnopedie", "gymnopédie"],
        "composer": "satie",
        "kind": "musetrainer",
        "file": "Erik_Satie_-_Gymnopedie_No.1.mxl",
    },
    {
        "keys": ["arabesque"],
        "composer": "debussy",
        "kind": "musetrainer",
        "file": "Arabesque_L._66_No._1_in_E_Major.mxl",
    },
]

CRAIG = {
    "beethoven-sonata": (
        "https://raw.githubusercontent.com/craigsapp/beethoven-piano-sonatas/master/kern/",
        "sonata{num:02d}-{mvt}.krn",
    ),
    "mozart-sonata": (
        "https://raw.githubusercontent.com/craigsapp/mozart-piano-sonatas/master/kern/",
        "sonata{num:02d}-{mvt}.krn",
    ),
    "chopin-mazurka": (
        "https://raw.githubusercontent.com/craigsapp/chopin-mazurkas/master/kern/",
        "mazurka{op:02d}-{no}.krn",
    ),
    "chopin-prelude": (
        "https://raw.githubusercontent.com/craigsapp/chopin-preludes/master/kern/",
        "prelude28-{no:02d}.krn",
    ),
    "joplin": (
        "https://raw.githubusercontent.com/craigsapp/joplin/master/kern/",
        "{slug}.krn",
    ),
    "haydn-sonata": (
        "https://raw.githubusercontent.com/craigsapp/haydn-piano-sonatas/master/kern/",
        "sonata{num}-{mvt}.krn",
    ),
    "scarlatti": (
        "https://raw.githubusercontent.com/craigsapp/scarlatti-keyboard-sonatas/master/kern/",
        "{filename}",
    ),
    "hummel-prelude": (
        "https://raw.githubusercontent.com/craigsapp/hummel-preludes/master/kern/",
        "prelude67-{no:02d}.krn",
    ),
    "bach-chorale": (
        "https://raw.githubusercontent.com/craigsapp/bach-370-chorales/master/kern/",
        "chor{num:03d}.krn",
    ),
    "art-of-fugue": (
        "https://raw.githubusercontent.com/craigsapp/art-of-the-fugue/master/kern/",
        "{filename}",
    ),
    "beethoven-quartet": (
        "https://raw.githubusercontent.com/craigsapp/beethoven-string-quartets/master/kern/",
        "quartet{num:02d}-{mvt}.krn",
    ),
}

STOP = {
    "the", "a", "an", "in", "on", "of", "for", "and", "or", "no", "op", "opus",
    "major", "minor", "piano", "sonata", "string", "quartet", "movement", "mvt",
    "from", "work", "piece", "flat", "sharp",
}

JOPlIN_TITLES = {
    "antoinette": "Antoinette",
    "augustan": "Augustan Club Waltz",
    "bethena": "Bethena",
    "binks": "Binks' Waltz",
    "breeze": "A Breeze from Alabama",
    "cascades": "The Cascades",
    "chrysanthemum": "The Chrysanthemum",
    "cleopha": "Cleopha",
    "combination": "Combination March",
    "countryclub": "Country Club",
    "crush": "The Crush Collision March",
    "easywinners": "The Easy Winners",
    "elite": "Elite Syncopations",
    "entertainer": "The Entertainer",
    "eugenia": "Eugenia",
    "favorite": "The Favorite",
    "felicity": "Felicity Rag",
    "figleaf": "Fig Leaf Rag",
    "gladiolus": "Gladiolus Rag",
    "harmony": "Harmony Club Waltz",
    "heliotrope": "Heliotrope Bouquet",
    "leola": "Leola",
    "lilyqueen": "Lily Queen",
    "magnetic": "Magnetic Rag",
    "majestic": "The Majestic",
    "mapleleaf": "Maple Leaf Rag",
    "newrag": "Original Rags",
    "nonpareil": "Nonpareil",
    "original": "Original Rags",
    "palmleaf": "Palm Leaf Rag",
    "paragon": "Paragon Rag",
    "peacherine": "Peacherine Rag",
    "pineapple": "Pine Apple Rag",
    "pleasant": "Pleasant Moments",
    "reflection": "Reflection Rag",
    "rosebud": "Rosebud March",
    "roseleaf": "Rose Leaf Rag",
    "school": "School of Ragtime",
    "searchlight": "Searchlight Rag",
    "solace": "Solace",
    "something": "Something Doing",
    "stoptime": "Stoptime Rag",
    "sugarcane": "Sugar Cane",
    "sunflower": "Sunflower Slow Drag",
    "swipesy": "Swipesy Cakewalk",
    "wallstreet": "Wall Street Rag",
    "weepingwillow": "Weeping Willow",
}

JOPlIN_SLUGS = {
    "maple leaf": "mapleleaf",
    "the entertainer": "entertainer",
    "entertainer": "entertainer",
    "easy winners": "easywinners",
    "pine apple": "pineapple",
    "pineapple": "pineapple",
    "solace": "solace",
    "bethena": "bethena",
    "cascades": "cascades",
    "elite syncopations": "elite",
    "fig leaf": "figleaf",
    "gladiolus": "gladiolus",
    "magnetic": "magnetic",
    "peacherine": "peacherine",
    "swipesy": "swipesy",
    "heliotrope": "heliotrope",
    "weeping willow": "weepingwillow",
    "wall street": "wallstreet",
    "stoptime": "stoptime",
    "sugar cane": "sugarcane",
    "sunflower": "sunflower",
}

CHOPIN_MAZURKA_OPS = [
    (6, 4), (7, 5), (17, 4), (24, 4), (30, 4), (33, 4), (41, 4),
    (50, 3), (56, 3), (59, 3), (63, 3), (67, 4), (68, 4),
]

# Haydn piano sonatas available in craigsapp (Hoboken numbering used in filenames)
HAYDN_SONATA_FILES = [
    (12, 1), (12, 2), (12, 3), (13, 1), (15, 1), (16, 1), (16, 2), (16, 3),
    (29, 3), (33, 3), (34, 1), (37, 1), (42, 3), (49, 1), (50, 1), (51, 3),
    (52, 3), (53, 3), (59, 1), (61, 1), (61, 2), (62, 1), (62, 2), (62, 3),
]

# Scarlatti Longo / Kirkpatrick pairs available in the repo
SCARLATTI_FILES = [
    "L001K514.krn", "L002K384.krn", "L003K502.krn", "L004K158.krn", "L005K406.krn",
    "L006K139.krn", "L008K461.krn", "L009K303.krn", "L010K084.krn", "L011K534.krn",
    "L012K478.krn", "L013K060.krn", "L014K492.krn", "L015K160.krn", "L016K306.krn",
    "L027K238.krn", "L051K166.krn", "L052K165.krn", "L053K075.krn", "L054K200.krn",
    "L055K330.krn", "L056K281.krn", "L064K148.krn", "L101K156.krn", "L127K348.krn",
    "L154K235.krn", "L164K491.krn", "L166K085.krn", "L178K258.krn", "L188K525.krn",
    "L198K296.krn", "L240K369.krn", "L267K052.krn", "L301K049.krn", "L302K372.krn",
    "L303K170.krn", "L304K470.krn", "L305K251.krn", "L306K345.krn", "L307K269.krn",
    "L319K442.krn", "L333K425.krn", "L334K122.krn", "L335K055.krn", "L336K093.krn",
    "L337K336.krn", "L338K450.krn", "L339K512.krn", "L340K476.krn", "L341K320.krn",
    "L342K220.krn", "L343K434.krn", "L344K114.krn", "L345K113.krn", "L346K408.krn",
    "L347K227.krn", "L348K244.krn", "L349K146.krn", "L350K498.krn", "L351K225.krn",
    "L366K001.krn", "L400K360.krn", "L481K025.krn", "L503K513.krn", "L523K205.krn",
]

ART_OF_FUGUE_FILES = [
    ("artfugue-001.krn", "Contrupunctus I"),
    ("artfugue-002.krn", "Contrupunctus II"),
    ("artfugue-003.krn", "Contrupunctus III"),
    ("artfugue-004.krn", "Contrupunctus IV"),
    ("artfugue-005.krn", "Contrupunctus V"),
    ("artfugue-006.krn", "Contrupunctus VI"),
    ("artfugue-007.krn", "Contrupunctus VII"),
    ("artfugue-008.krn", "Contrupunctus VIII"),
    ("artfugue-009.krn", "Contrupunctus IX"),
    ("artfugue-010.krn", "Contrupunctus X"),
    ("artfugue-011.krn", "Contrupunctus XI"),
    ("artfugue-012.krn", "Contrupunctus XII"),
    ("artfugue-013.krn", "Contrupunctus XIII"),
    ("artfugue-014.krn", "Contrupunctus XIV"),
    ("artfugue-015.krn", "Canon alla Ottava"),
    ("artfugue-016a.krn", "Canon alla Decima"),
    ("artfugue-016b.krn", "Canon alla Duodecima"),
    ("artfugue-018a.krn", "Canon per Augmentationem"),
    ("artfugue-018b.krn", "Canon per Augmentationem (alt)"),
    ("artfugue-019.krn", "Fuga a 3 soggetti (unfinished)"),
]

BEETHOVEN_NICKNAMES = {
    8: "Pathétique",
    14: "Moonlight",
    17: "Tempest",
    21: "Waldstein",
    23: "Appassionata",
    26: "Les Adieux",
    29: "Hammerklavier",
}

MOZART_K_MAP = {
    279: 1, 280: 2, 281: 3, 282: 4, 283: 5, 284: 6, 309: 7, 311: 9,
    310: 8, 330: 10, 331: 11, 332: 12, 333: 13, 457: 14, 533: 15,
    545: 16, 570: 17, 576: 18,
}

CORPUS_COMPOSERS = {
    "bach": "Johann Sebastian Bach",
    "beethoven": "Ludwig van Beethoven",
    "mozart": "Wolfgang Amadeus Mozart",
    "haydn": "Joseph Haydn",
    "chopin": "Frédéric Chopin",
    "schumann": "Robert Schumann",
    "schumann_clara": "Clara Schumann",
    "joplin": "Scott Joplin",
    "schubert": "Franz Schubert",
    "handel": "George Frideric Handel",
    "beach": "Amy Beach",
    "cpebach": "C. P. E. Bach",
    "verdi": "Giuseppe Verdi",
    "weber": "Carl Maria von Weber",
    "corelli": "Arcangelo Corelli",
    "monteverdi": "Claudio Monteverdi",
}


def _norm(text: str) -> str:
    text = (text or "").lower()
    text = text.replace("♯", "sharp").replace("#", "sharp").replace("♭", "flat")
    text = text.replace("für", "fur").replace("ü", "u").replace("é", "e").replace("è", "e")
    text = text.replace("ö", "o").replace("ä", "a").replace("ß", "ss")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _composer_hit(query: str, composer: str) -> bool:
    c = _norm(composer)
    if not c:
        return True
    if c in query:
        return True
    last = c.split()[-1]
    if last in {"traditional", "anonymous", "unknown", "folk"}:
        return True
    return bool(last and last in query)


def _title_score(query: str, entry: Dict[str, Any]) -> int:
    points = 0
    title_n = _norm(entry["title"])
    for key in entry.get("keys", []):
        key_n = _norm(key)
        if key_n and key_n in query:
            points += 14 if len(key_n) >= 5 else 9
    title_tokens = {t for t in title_n.split() if t not in STOP and len(t) > 1}
    overlap = title_tokens & set(query.split())
    points += min(12, 3 * len(overlap))
    if title_n and title_n in query:
        points += 16
    q_field = _norm(entry.get("query", ""))
    if q_field:
        if q_field == query:
            points += 22
        elif q_field in query:
            points += 16
        elif query in q_field:
            # Avoid "op 11 no 1" matching inside "op 11 no 10"
            q_tokens = query.split()
            f_tokens = q_field.split()
            if q_tokens and f_tokens and q_tokens[-1].isdigit() and f_tokens[-1].isdigit():
                if q_tokens[-1] != f_tokens[-1]:
                    points -= 12
                else:
                    points += 10
            else:
                points += 8
    # Exact catalogue numbers (prelude 15 vs prelude 1, sonata 8, chorale 40…)
    for kind, pattern in (
        ("prelude", r"prelude(?:\s+op(?:us|\.)?\s*\d+)?(?:\s+no\.?)?\s*(\d{1,2})"),
        ("sonata", r"sonata(?:\s+no\.?)?\s*(\d{1,2})"),
        ("chorale", r"chorale(?:\s+no\.?)?\s*(\d{1,3})"),
        ("mazurka", r"mazurka(?:\s+op(?:us|\.)?\s*\d+)?(?:\s+no\.?)?\s*(\d{1,2})"),
        ("op", r"op(?:us|\.)?\s*(\d{1,2})(?:\s+no\.?\s*(\d{1,2}))?"),
    ):
        qm = re.search(pattern, query)
        em = re.search(pattern, title_n)
        if not qm or not em:
            continue
        if kind == "op":
            if int(qm.group(1)) == int(em.group(1)):
                points += 10
                qn = qm.group(2)
                en = em.group(2)
                if qn and en and int(qn) == int(en):
                    points += 14
                elif qn and en and int(qn) != int(en):
                    points -= 16
            elif int(qm.group(1)) != int(em.group(1)):
                points -= 8
            continue
        if int(qm.group(1)) == int(em.group(1)):
            points += 18
        elif int(qm.group(1)) != int(em.group(1)):
            points -= 10
    if "raindrop" in query and "raindrop" in title_n:
        points += 25
    return points


def _library_path(filename: str) -> Optional[Path]:
    path = LIBRARY / filename
    if path.exists():
        return path
    alt = ROOT / "samples" / filename
    return alt if alt.exists() else None


def match_library(title: str, composer: str = "") -> Optional[Tuple[Path, Dict[str, Any], int]]:
    query = _norm(f"{composer} {title}")
    if not query:
        return None
    best: Tuple[int, Optional[Path], Optional[Dict[str, Any]]] = (0, None, None)
    for entry in LIBRARY_INDEX:
        path = _library_path(entry["file"])
        if not path:
            continue
        if not _composer_hit(query, entry["composer"]):
            continue
        points = _title_score(query, entry)
        if points > best[0]:
            best = (points, path, entry)
    if best[0] >= 8 and best[1] and best[2]:
        return best[1], best[2], best[0]
    return None


def _cache_dir() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE


def _download(url: str, timeout: float = 25.0) -> Optional[bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
            if not data or data[:15].lower().startswith(b"<!doctype") or data[:6].lower().startswith(b"<html"):
                return None
            return data
    except Exception:
        return None


def _kern_to_musicxml(raw: bytes, cache_name: str) -> Optional[Path]:
    cached = _cache_dir() / cache_name
    if cached.exists() and cached.stat().st_size > 800:
        return cached
    with tempfile.NamedTemporaryFile(suffix=".krn", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        score = converter.parse(tmp_path)
        score.write("musicxml", fp=str(cached))
        return cached if cached.exists() and cached.stat().st_size > 500 else None
    except Exception:
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _fetch_kern(base_url: str, filename: str, cache_name: str) -> Optional[Path]:
    cached = _cache_dir() / cache_name
    if cached.exists() and cached.stat().st_size > 800:
        return cached
    raw = _download(base_url + filename)
    if not raw:
        return None
    return _kern_to_musicxml(raw, cache_name)


def _bytes_to_musicxml(raw: bytes, cache_name: str, suffix: str = ".musicxml") -> Optional[Path]:
    """Parse MusicXML / compressed .mxl bytes and cache as uncompressed MusicXML."""
    cached = _cache_dir() / cache_name
    if cached.exists() and cached.stat().st_size > 500:
        return cached
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        score = converter.parse(tmp_path)
        try:
            score.write("musicxml", fp=str(cached))
        except Exception:
            # Some MuseScore MXLs parse but fail round-trip; extract XML from the zip.
            if suffix == ".mxl" or raw[:2] == b"PK":
                import zipfile
                with zipfile.ZipFile(tmp_path) as zf:
                    names = [
                        n for n in zf.namelist()
                        if n.lower().endswith((".xml", ".musicxml")) and not n.startswith("META")
                    ]
                    if not names:
                        return None
                    cached.write_bytes(zf.read(names[0]))
            else:
                cached.write_bytes(raw)
        return cached if cached.exists() and cached.stat().st_size > 500 else None
    except Exception:
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def _fetch_musicxml_url(url: str, cache_name: str) -> Optional[Path]:
    cached = _cache_dir() / cache_name
    if cached.exists() and cached.stat().st_size > 500:
        return cached
    raw = _download(url)
    if not raw:
        return None
    # Detect packed MusicXML (.mxl is a zip)
    suffix = ".mxl" if raw[:2] == b"PK" or url.lower().endswith(".mxl") else ".musicxml"
    return _bytes_to_musicxml(raw, cache_name, suffix=suffix)


def fetch_musetrainer(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if not blob:
        return None
    best: Tuple[int, Optional[Dict[str, Any]]] = (0, None)
    for entry in MUSETAINER_INDEX:
        score = _title_score(blob, entry)
        if _composer_hit(blob, entry["composer"]):
            score += 3
        if score > best[0]:
            best = (score, entry)
    if best[0] < 8 or not best[1]:
        return None
    entry = best[1]
    return _fetch_musicxml_url(
        MUSETAINER_BASE + entry["file"],
        "mt_" + re.sub(r"[^a-zA-Z0-9]+", "_", entry["file"])[-80:] + ".musicxml",
    )


def fetch_openscore(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if not blob:
        return None
    for entry in OPENSCORE_INDEX:
        if _title_score(blob, entry) < 8 and not any(k in blob for k in entry.get("keys", [])):
            continue
        if not _composer_hit(blob, entry["composer"]) and "liszt" not in blob:
            continue
        return _fetch_musicxml_url(
            OPENSCORE_BASE + entry["path"],
            "os_" + re.sub(r"[^a-zA-Z0-9]+", "_", entry["path"])[-80:] + ".musicxml",
        )
    return None


def fetch_scriabin(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "scriabin" not in blob and "skryabin" not in blob and "skriabin" not in blob:
        return None
    op = re.search(r"op(?:us|\.)?\s*(\d{1,2})", blob)
    no = re.search(r"(?:no\.?|number|#)\s*(\d{1,2})", blob)
    op_n = int(op.group(1)) if op else None
    no_n = int(no.group(1)) if no else None
    candidates: List[str] = []
    for rel in SCRIABIN_KERNS:
        if op_n is None:
            continue
        name = rel.split("/")[-1]
        m = re.match(r"scriabin-op(\d+)(?:_no(\d+))?", name, re.I)
        if not m or int(m.group(1)) != op_n:
            continue
        file_no = int(m.group(2)) if m.group(2) else None
        if no_n is not None and file_no is not None and file_no != no_n:
            continue
        if no_n is not None and file_no is None:
            continue
        candidates.append(rel)
    if not candidates:
        # Default popular prelude if composer-only
        candidates = ["op11/scriabin-op11_no01.krn"]
    for rel in candidates:
        path = _fetch_kern(
            SCRIABIN_BASE,
            rel,
            "scriabin_" + re.sub(r"[^a-zA-Z0-9]+", "_", rel) + ".musicxml",
        )
        if path:
            return path
    return None


def fetch_liszt_kernscores(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "liszt" not in blob and "franz" not in blob:
        if not any(k in blob for e in KERNSCORES_LISZT_INDEX for k in e.get("keys", [])):
            return None
    best: Tuple[int, Optional[Dict[str, Any]]] = (0, None)
    for entry in KERNSCORES_LISZT_INDEX:
        score = _title_score(blob, entry)
        if "liszt" in blob:
            score += 4
        if score > best[0]:
            best = (score, entry)
    if best[0] < 6 or not best[1]:
        # Still try ballade if liszt + ballade
        if "ballade" in blob and "liszt" in blob:
            entry = KERNSCORES_LISZT_INDEX[0]
        else:
            return None
    else:
        entry = best[1]
    url = KERNSCORES_LISZT.format(file=entry["file"])
    raw = _download(url)
    if not raw or raw[:1] != b"!" and b"**kern" not in raw[:500]:
        return None
    return _kern_to_musicxml(raw, f"liszt_{entry['file'].replace('.krn', '')}.musicxml")


def _sonata_number(blob: str) -> Optional[int]:
    for nick, num in (
        ("moonlight", 14), ("pathetique", 8), ("pathétique", 8),
        ("appassionata", 23), ("waldstein", 21), ("tempest", 17),
        ("hammerklavier", 29), ("les adieux", 26), ("farewell", 26),
    ):
        if nick in blob:
            return num
    match = re.search(r"sonata(?:\s+no\.?)?\s*(\d{1,2})", blob)
    if match:
        return int(match.group(1))
    return None


def _movement(blob: str) -> int:
    match = re.search(r"(?:movement|mvt|mov)\s*(\d)", blob)
    if match:
        return max(1, min(4, int(match.group(1))))
    if "2nd" in blob or "second" in blob:
        return 2
    if "3rd" in blob or "third" in blob:
        return 3
    if "4th" in blob or "fourth" in blob:
        return 4
    return 1


def fetch_beethoven_sonata(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "beethoven" not in blob and "ludwig" not in blob and not any(
        n in blob for n in BEETHOVEN_NICKNAMES.values()
    ) and "moonlight" not in blob and "pathetique" not in blob and "appassionata" not in blob:
        return None
    if "quartet" in blob:
        return None
    num = _sonata_number(blob)
    if num is None or num < 1 or num > 32:
        return None
    mvt = _movement(blob)
    base, pattern = CRAIG["beethoven-sonata"]
    return _fetch_kern(
        base,
        pattern.format(num=num, mvt=mvt),
        f"beethoven_sonata{num:02d}-{mvt}.musicxml",
    )


def fetch_mozart_sonata(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "mozart" not in blob and "wolfgang" not in blob:
        return None
    num = _sonata_number(blob)
    if num is None:
        k = re.search(r"\bk\s*\.?\s*(\d{2,3})\b", blob)
        if k:
            num = MOZART_K_MAP.get(int(k.group(1)))
    if num is None or num < 1 or num > 18:
        return None
    if "quartet" in blob or "k 155" in blob or "k155" in blob:
        return None
    mvt = _movement(blob)
    base, pattern = CRAIG["mozart-sonata"]
    return _fetch_kern(
        base,
        pattern.format(num=num, mvt=mvt),
        f"mozart_sonata{num:02d}-{mvt}.musicxml",
    )


def fetch_chopin(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "raindrop" in blob:
        blob = blob + " chopin prelude 15"

    if "chopin" not in blob and "frederic" not in blob and "fryderyk" not in blob:
        if "mazurka" not in blob and "prelude" not in blob and "raindrop" not in blob:
            return None

    if "mazurka" in blob:
        op = re.search(r"op(?:us|\.)?\s*(\d{1,2})", blob)
        no = re.search(r"(?:no\.?|number)\s*(\d{1,2})", blob)
        op_n = int(op.group(1)) if op else 6
        no_n = int(no.group(1)) if no else 1
        base, pattern = CRAIG["chopin-mazurka"]
        path = _fetch_kern(
            base,
            pattern.format(op=op_n, no=no_n),
            f"chopin_mazurka{op_n:02d}-{no_n}.musicxml",
        )
        if path:
            return path
        return _fetch_kern(base, "mazurka06-2.krn", "chopin_mazurka06-2.musicxml")

    if "prelude" in blob:
        no = re.search(r"(?:no\.?|number|#)\s*(\d{1,2})", blob)
        if not no:
            no = re.search(r"prelude(?:\s+op(?:us|\.)?\s*28)?\s*(\d{1,2})", blob)
        no_n = 15 if "raindrop" in blob else (int(no.group(1)) if no else 1)
        no_n = max(1, min(24, no_n))
        base, pattern = CRAIG["chopin-prelude"]
        return _fetch_kern(
            base,
            pattern.format(no=no_n),
            f"chopin_prelude28-{no_n:02d}.musicxml",
        )
    return None


def fetch_joplin(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "joplin" not in blob and not any(k in blob for k in JOPlIN_SLUGS) and not any(
        s in blob for s in JOPlIN_TITLES
    ):
        return None
    slug = None
    for key, value in JOPlIN_SLUGS.items():
        if key in blob:
            slug = value
            break
    if not slug:
        for s, pretty in JOPlIN_TITLES.items():
            if s in blob or _norm(pretty) in blob:
                slug = s
                break
    if not slug:
        slug = "entertainer"
    base, pattern = CRAIG["joplin"]
    return _fetch_kern(base, pattern.format(slug=slug), f"joplin_{slug}.musicxml")


def fetch_haydn_sonata(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "haydn" not in blob and "joseph" not in blob:
        return None
    num = _sonata_number(blob)
    if num is None:
        hob = re.search(r"(?:hob|hoboken)\s*[xvi.\s]*(\d{1,2})", blob)
        if hob:
            num = int(hob.group(1))
    if num is None:
        return None
    mvt = _movement(blob)
    # Prefer exact file; else first available movement for that sonata
    candidates = [(num, mvt)] + [(n, m) for n, m in HAYDN_SONATA_FILES if n == num]
    base, pattern = CRAIG["haydn-sonata"]
    seen = set()
    for n, m in candidates:
        key = (n, m)
        if key in seen:
            continue
        seen.add(key)
        # filename uses unpadded sonata number
        for fname in (f"sonata{n}-{m}.krn", f"sonata{n:02d}-{m}.krn"):
            path = _fetch_kern(base, fname, f"haydn_sonata{n}-{m}.musicxml")
            if path:
                return path
    return None


def fetch_scarlatti(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "scarlatti" not in blob and "domenico" not in blob:
        return None
    k = re.search(r"\bk\s*\.?\s*(\d{1,3})\b", blob)
    l = re.search(r"\bl\s*\.?\s*(\d{1,3})\b", blob)
    base, _ = CRAIG["scarlatti"]
    if k:
        kn = int(k.group(1))
        for fname in SCARLATTI_FILES:
            m = re.search(r"K(\d{3})", fname)
            if m and int(m.group(1)) == kn:
                return _fetch_kern(base, fname, f"scarlatti_{fname.replace('.krn', '')}.musicxml")
    if l:
        ln = int(l.group(1))
        for fname in SCARLATTI_FILES:
            m = re.search(r"L(\d{3})", fname)
            if m and int(m.group(1)) == ln:
                return _fetch_kern(base, fname, f"scarlatti_{fname.replace('.krn', '')}.musicxml")
    # Popular default K.1 / L.366
    return _fetch_kern(base, "L366K001.krn", "scarlatti_L366K001.musicxml")


def fetch_hummel(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "hummel" not in blob:
        return None
    no = re.search(r"(?:prelude|no\.?|number|#)\s*(\d{1,2})", blob)
    no_n = int(no.group(1)) if no else 1
    no_n = max(1, min(24, no_n))
    base, pattern = CRAIG["hummel-prelude"]
    return _fetch_kern(base, pattern.format(no=no_n), f"hummel_prelude67-{no_n:02d}.musicxml")


def fetch_bach_chorale(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "chorale" not in blob and "chor" not in blob:
        return None
    if "bach" not in blob and "johann" not in blob and "sebastian" not in blob:
        # still allow bare "chorale 140"
        if "chorale" not in blob:
            return None
    no = re.search(r"(?:chorale|chor|no\.?|number|#)\s*(\d{1,3})", blob)
    if not no:
        return None
    no_n = max(1, min(370, int(no.group(1))))
    base, pattern = CRAIG["bach-chorale"]
    return _fetch_kern(base, pattern.format(num=no_n), f"bach_chorale{no_n:03d}.musicxml")


def fetch_art_of_fugue(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "art of the fugue" not in blob and "art of fugue" not in blob and "kunst der fuge" not in blob:
        if "contrapunctus" not in blob:
            return None
    no = re.search(r"(?:contrapunctus|fugue|no\.?|#)\s*([ivx\d]+)", blob)
    base, _ = CRAIG["art-of-fugue"]
    if no:
        token = no.group(1)
        if token.isdigit():
            idx = int(token)
            fname = f"artfugue-{idx:03d}.krn"
            return _fetch_kern(base, fname, f"bach_{fname.replace('.krn', '')}.musicxml")
    return _fetch_kern(base, "artfugue-001.krn", "bach_artfugue-001.musicxml")


def fetch_beethoven_quartet(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "quartet" not in blob:
        return None
    if "beethoven" not in blob and "ludwig" not in blob:
        return None
    # op.18 nos map to quartets 1-6; op.59 to 7-9; etc.
    op = re.search(r"op(?:us|\.)?\s*(\d+)", blob)
    no = re.search(r"(?:no\.?|number)\s*(\d)", blob)
    qnum = None
    if op:
        op_n = int(op.group(1))
        no_n = int(no.group(1)) if no else 1
        mapping = {
            18: {1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6},
            59: {1: 7, 2: 8, 3: 9},
            74: {1: 10},
            95: {1: 11},
            127: {1: 12},
            130: {1: 13},
            131: {1: 14},
            132: {1: 15},
            135: {1: 16},
        }
        qnum = mapping.get(op_n, {}).get(no_n)
    if qnum is None:
        q = re.search(r"quartet(?:\s+no\.?)?\s*(\d{1,2})", blob)
        if q:
            qnum = int(q.group(1))
    if qnum is None or qnum < 1 or qnum > 16:
        return None
    mvt = _movement(blob)
    base, pattern = CRAIG["beethoven-quartet"]
    return _fetch_kern(
        base,
        pattern.format(num=qnum, mvt=mvt),
        f"beethoven_quartet{qnum:02d}-{mvt}.musicxml",
    )


def fetch_music21_corpus(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if not blob:
        return None

    # Direct corpus path from catalogue entries
    for entry in _corpus_catalogue():
        if entry.get("corpusPath") and (
            _norm(entry["query"]) == blob
            or _norm(entry["title"]) in blob
            or blob in _norm(f"{entry['composer']} {entry['title']}")
        ):
            if _title_score(blob, entry) >= 8 or _norm(entry["query"]) == blob:
                return _parse_corpus_path(entry["corpusPath"])

    queries: List[str] = []
    bwv = re.search(r"bwv\s*\.?(\d+[a-z]?)", blob)
    if bwv:
        queries.append(f"bwv{bwv.group(1)}")

    op = re.search(r"op(?:us|\.)?\s*(\d+)(?:\s*no\.?\s*(\d+))?", blob)
    knum = re.search(r"\bk\s*\.?\s*(\d{2,3})\b", blob)

    distinctive = bool(
        bwv or op or knum or "elise" in blob or "dichterliebe" in blob
        or "lindenbaum" in blob or "maple" in blob
    )
    if not distinctive:
        # Try corpus catalogue fuzzy
        best = None
        best_score = 0
        for entry in _corpus_catalogue():
            score = _title_score(blob, entry)
            if _composer_hit(blob, entry["composer"]):
                score += 4
            if score > best_score:
                best_score = score
                best = entry
        if best and best_score >= 10:
            return _parse_corpus_path(best["corpusPath"])
        return None

    if op:
        queries.append(op.group(0))
    if knum:
        queries.append(f"k{knum.group(1)}")
        queries.append(f"k.{knum.group(1)}")

    last = (composer or "").split()[-1].lower() if composer else ""
    if bwv and (not last or last in blob or "bach" in blob):
        try:
            for path in list(corpus.getComposer("bach")):
                path_s = str(path).lower().replace(".", "")
                if f"bwv{bwv.group(1).lower()}" in path_s or f"bwv{bwv.group(1)}" in str(path).lower():
                    queries.insert(0, str(path))
                    break
        except Exception:
            pass

    if "elise" in blob:
        queries.extend(["elise", "bagatelle"])

    seen = set()
    for q in queries:
        key = q.lower()
        if key in seen or len(key) < 3:
            continue
        seen.add(key)
        try:
            if "/" in q or q.endswith((".mxl", ".xml", ".krn", ".musicxml")):
                hits = [q]
            else:
                hits = [str(getattr(h, "sourcePath", "") or "") for h in list(corpus.search(q))[:8]]
        except Exception:
            continue
        for source in hits:
            if not source or str(source).endswith(".abc"):
                continue
            source_s = str(source)
            source_n = _norm(source_s)
            if last and last not in {"traditional"} and last not in source_n and last not in blob:
                if not bwv:
                    continue
            path = _parse_corpus_path(source_s)
            if path:
                return path
    return None


def _parse_corpus_path(source_s: str) -> Optional[Path]:
    cache_name = "corpus_" + re.sub(r"[^a-zA-Z0-9]+", "_", source_s)[-90:] + ".musicxml"
    cached = _cache_dir() / cache_name
    if cached.exists() and cached.stat().st_size > 500:
        return cached
    try:
        score = corpus.parse(source_s)
        score.write("musicxml", fp=str(cached))
        if cached.exists() and cached.stat().st_size > 500:
            return cached
    except Exception:
        return None
    return None


def _alias_resolve(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    for alias in ALIASES:
        if not any(k in blob for k in alias["keys"]):
            continue
        kind = alias["kind"]
        if kind == "library":
            return _library_path(alias["file"])
        if kind == "beethoven-sonata":
            return fetch_beethoven_sonata(f"sonata {alias['number']}", "beethoven")
        if kind == "chopin-prelude":
            return fetch_chopin(f"prelude {alias['number']}", "chopin")
        if kind == "musetrainer":
            return _fetch_musicxml_url(
                MUSETAINER_BASE + alias["file"],
                "mt_" + re.sub(r"[^a-zA-Z0-9]+", "_", alias["file"])[-80:] + ".musicxml",
            )
        if kind == "corpus":
            for q in alias.get("queries", []):
                path = fetch_music21_corpus(q, alias.get("composer", ""))
                if path:
                    return path
    return None


def _pretty_corpus_title(path_s: str, composer_key: str) -> str:
    name = Path(path_s).stem
    name = name.replace("_", " ").replace("-", " ")
    # bwv846 → BWV 846
    m = re.search(r"bwv\s*([0-9]+[a-z]?)", name, re.I)
    if m:
        return f"BWV {m.group(1)}"
    m = re.search(r"opus\s*(\d+)\s*no\s*(\d+)", name, re.I)
    if m:
        return f"Op. {m.group(1)} no. {m.group(2)}"
    m = re.search(r"k\s*(\d+)", name, re.I)
    if m:
        return f"K.{m.group(1)}"
    return name.title() if name else composer_key.title()


@lru_cache(maxsize=1)
def _corpus_catalogue() -> Tuple[Dict[str, Any], ...]:
    items: List[Dict[str, Any]] = []
    for key, display in CORPUS_COMPOSERS.items():
        try:
            paths = list(corpus.getComposer(key))
        except Exception:
            continue
        seen = set()
        for path in paths:
            path_s = str(path)
            # Prefer .mxl/.musicxml/.xml over duplicate .krn
            stem = Path(path_s).with_suffix("").as_posix()
            if stem in seen and path_s.endswith(".krn"):
                continue
            seen.add(stem)
            if path_s.endswith(".abc"):
                continue
            title = _pretty_corpus_title(path_s, key)
            # Include parent folder for movement context
            parent = Path(path_s).parent.name
            if parent and parent not in {key, "corpus"} and parent.lower() not in title.lower():
                if "movement" in Path(path_s).stem.lower() or re.search(r"movement\d", path_s, re.I):
                    title = f"{parent} — {Path(path_s).stem.replace('_', ' ')}"
            rel = path_s
            if "corpus/" in path_s:
                rel = path_s.split("corpus/", 1)[1]
            items.append(
                {
                    "title": title,
                    "composer": display,
                    "query": f"{key} {title}",
                    "keys": [title.lower(), Path(path_s).stem.lower(), rel.lower()],
                    "group": f"music21 · {display}",
                    "corpusPath": path_s if "/" in path_s and not path_s.startswith("http") else rel,
                    "source": "music21-corpus",
                }
            )
    return tuple(items)


@lru_cache(maxsize=1)
def build_catalogue() -> Tuple[Dict[str, Any], ...]:
    """Every free score Lune can open — used by library UI and search merge."""
    items: List[Dict[str, Any]] = []

    for entry in LIBRARY_INDEX:
        if not _library_path(entry["file"]):
            continue
        items.append(
            {
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["keys"][0],
                "keys": entry["keys"],
                "group": "Featured",
                "source": "library",
                "file": entry["file"],
            }
        )

    for entry in MUSETAINER_INDEX:
        items.append(
            {
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["keys"][0],
                "keys": entry["keys"],
                "group": f"Open MusicXML · {entry['composer'].split()[-1]}",
                "source": "musetrainer",
                "file": entry["file"],
            }
        )

    for entry in OPENSCORE_INDEX:
        items.append(
            {
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["keys"][0],
                "keys": entry["keys"],
                "group": "OpenScore Lieder",
                "source": "openscore",
                "path": entry["path"],
            }
        )

    for entry in KERNSCORES_LISZT_INDEX:
        items.append(
            {
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["keys"][0],
                "keys": entry["keys"],
                "group": "Liszt · KernScores",
                "source": "kernscores-liszt",
                "file": entry["file"],
            }
        )

    for rel in SCRIABIN_KERNS:
        title = scriabin_title(rel)
        items.append(
            {
                "title": title,
                "composer": "Alexander Scriabin",
                "query": f"scriabin {title}",
                "keys": [title.lower(), "scriabin", rel.split("/")[-1].replace(".krn", "")],
                "group": "Scriabin piano",
                "source": "scriabin",
                "rel": rel,
            }
        )

    for n in range(1, 33):
        label = f"Piano Sonata no. {n}"
        nick = BEETHOVEN_NICKNAMES.get(n)
        if nick:
            label += f' "{nick}"'
        items.append(
            {
                "title": label,
                "composer": "Ludwig van Beethoven",
                "query": f"beethoven sonata {n}",
                "keys": [f"sonata {n}", f"sonata no {n}", nick.lower() if nick else ""],
                "group": "Beethoven piano sonatas",
                "source": "beethoven-sonatas",
                "sonata": n,
            }
        )

    for n in range(1, 19):
        items.append(
            {
                "title": f"Piano Sonata no. {n}",
                "composer": "Wolfgang Amadeus Mozart",
                "query": f"mozart sonata {n}",
                "keys": [f"mozart sonata {n}", f"sonata {n}"],
                "group": "Mozart piano sonatas",
                "source": "mozart-sonatas",
                "sonata": n,
            }
        )

    for n, m in HAYDN_SONATA_FILES:
        items.append(
            {
                "title": f"Piano Sonata Hob. XVI:{n} — Movement {m}",
                "composer": "Joseph Haydn",
                "query": f"haydn sonata {n} movement {m}",
                "keys": [f"haydn sonata {n}", f"hob xvi {n}"],
                "group": "Haydn piano sonatas",
                "source": "haydn-sonatas",
                "sonata": n,
                "movement": m,
            }
        )

    for n in range(1, 25):
        label = f"Prelude op. 28 no. {n}"
        if n == 15:
            label += ' "Raindrop"'
        items.append(
            {
                "title": label,
                "composer": "Frédéric Chopin",
                "query": f"chopin prelude {n}",
                "keys": [f"prelude {n}", "raindrop" if n == 15 else ""],
                "group": "Chopin preludes",
                "source": "chopin",
                "prelude": n,
            }
        )

    for op, count in CHOPIN_MAZURKA_OPS:
        for no in range(1, count + 1):
            items.append(
                {
                    "title": f"Mazurka op. {op} no. {no}",
                    "composer": "Frédéric Chopin",
                    "query": f"chopin mazurka op {op} no {no}",
                    "keys": [f"mazurka op {op} no {no}", f"mazurka {op} {no}"],
                    "group": "Chopin mazurkas",
                    "source": "chopin",
                    "op": op,
                    "no": no,
                }
            )

    for slug, title in JOPlIN_TITLES.items():
        items.append(
            {
                "title": title,
                "composer": "Scott Joplin",
                "query": title.lower(),
                "keys": [title.lower(), slug, "joplin"],
                "group": "Joplin rags",
                "source": "joplin",
                "slug": slug,
            }
        )

    for fname in SCARLATTI_FILES:
        m = re.match(r"L(\d+)K(\d+)", fname.replace(".krn", ""))
        if not m:
            continue
        l_n, k_n = int(m.group(1)), int(m.group(2))
        items.append(
            {
                "title": f"Keyboard Sonata K.{k_n} / L.{l_n}",
                "composer": "Domenico Scarlatti",
                "query": f"scarlatti k {k_n}",
                "keys": [f"k {k_n}", f"l {l_n}", "scarlatti"],
                "group": "Scarlatti sonatas",
                "source": "scarlatti",
                "filename": fname,
            }
        )

    for n in range(1, 25):
        items.append(
            {
                "title": f"Prelude op. 67 no. {n}",
                "composer": "Johann Nepomuk Hummel",
                "query": f"hummel prelude {n}",
                "keys": [f"hummel prelude {n}"],
                "group": "Hummel preludes",
                "source": "hummel",
                "prelude": n,
            }
        )

    for n in range(1, 371):
        items.append(
            {
                "title": f"Chorale no. {n}",
                "composer": "Johann Sebastian Bach",
                "query": f"bach chorale {n}",
                "keys": [f"chorale {n}", f"chor {n}"],
                "group": "Bach chorales",
                "source": "bach-chorale",
                "chorale": n,
            }
        )

    for fname, label in ART_OF_FUGUE_FILES:
        items.append(
            {
                "title": f"The Art of Fugue — {label}",
                "composer": "Johann Sebastian Bach",
                "query": f"bach art of fugue {label}",
                "keys": ["art of the fugue", "art of fugue", label.lower()],
                "group": "Bach · Art of Fugue",
                "source": "art-of-fugue",
                "filename": fname,
            }
        )

    for q in range(1, 17):
        for m in range(1, 5):
            items.append(
                {
                    "title": f"String Quartet no. {q} — Movement {m}",
                    "composer": "Ludwig van Beethoven",
                    "query": f"beethoven quartet {q} movement {m}",
                    "keys": [f"quartet {q}", f"string quartet {q}"],
                    "group": "Beethoven string quartets",
                    "source": "beethoven-quartets",
                    "quartet": q,
                    "movement": m,
                }
            )

    for entry in _corpus_catalogue():
        items.append(dict(entry))

    return tuple(items)


def list_available() -> List[Dict[str, str]]:
    """Human-facing catalogue of free scores Lune can open today."""
    out: List[Dict[str, str]] = []
    for entry in build_catalogue():
        out.append(
            {
                "title": entry["title"],
                "composer": entry["composer"],
                "query": entry["query"],
                "group": entry["group"],
                "source": entry.get("source", ""),
            }
        )
    return out


def search_library(query: str, limit: int = 24) -> List[Dict[str, Any]]:
    """Ranked free-score hits for merging into omnisearch."""
    q = _norm(query)
    if len(q) < 2:
        return []
    scored: List[Tuple[int, Dict[str, Any]]] = []
    for entry in build_catalogue():
        score = _title_score(q, entry)
        if _composer_hit(q, entry["composer"]):
            score += 3
        # composer-only browse
        composer_n = _norm(entry["composer"])
        last = composer_n.split()[-1] if composer_n else ""
        if q == last or q in composer_n:
            score = max(score, 6)
        if score < 6:
            continue
        scored.append(
            (
                score,
                {
                    "kind": "work",
                    "id": f"free-{entry['query']}",
                    "title": entry["title"],
                    "composer": entry["composer"],
                    "subtitle": f"Free score · {entry['group']}",
                    "epoch": "",
                    "portrait": "",
                    "imslpQuery": f"{entry['composer']} {entry['title']}",
                    "openable": True,
                    "query": entry["query"],
                },
            )
        )
    scored.sort(key=lambda x: -x[0])
    # Deduplicate by title+composer
    seen = set()
    results = []
    for _, row in scored:
        key = (row["title"], row["composer"])
        if key in seen:
            continue
        seen.add(key)
        results.append(row)
        if len(results) >= limit:
            break
    return results


def _fetch_from_catalogue_entry(entry: Dict[str, Any]) -> Optional[Path]:
    source = entry.get("source")
    if source == "library":
        return _library_path(entry.get("file", ""))
    if source == "musetrainer":
        return _fetch_musicxml_url(
            MUSETAINER_BASE + entry["file"],
            "mt_" + re.sub(r"[^a-zA-Z0-9]+", "_", entry["file"])[-80:] + ".musicxml",
        )
    if source == "openscore":
        return _fetch_musicxml_url(
            OPENSCORE_BASE + entry["path"],
            "os_" + re.sub(r"[^a-zA-Z0-9]+", "_", entry["path"])[-80:] + ".musicxml",
        )
    if source == "kernscores-liszt":
        return fetch_liszt_kernscores(entry["title"], entry["composer"])
    if source == "scriabin":
        return _fetch_kern(
            SCRIABIN_BASE,
            entry["rel"],
            "scriabin_" + re.sub(r"[^a-zA-Z0-9]+", "_", entry["rel"]) + ".musicxml",
        )
    if source == "beethoven-sonatas":
        return fetch_beethoven_sonata(f"sonata {entry['sonata']}", "beethoven")
    if source == "mozart-sonatas":
        return fetch_mozart_sonata(f"sonata {entry['sonata']}", "mozart")
    if source == "haydn-sonatas":
        return fetch_haydn_sonata(
            f"sonata {entry['sonata']} movement {entry.get('movement', 1)}", "haydn"
        )
    if source == "chopin":
        if "prelude" in entry:
            return fetch_chopin(f"prelude {entry['prelude']}", "chopin")
        return fetch_chopin(f"mazurka op {entry['op']} no {entry['no']}", "chopin")
    if source == "joplin":
        return fetch_joplin(entry.get("slug") or entry["title"], "joplin")
    if source == "scarlatti":
        base, _ = CRAIG["scarlatti"]
        fname = entry["filename"]
        return _fetch_kern(base, fname, f"scarlatti_{fname.replace('.krn', '')}.musicxml")
    if source == "hummel":
        return fetch_hummel(f"prelude {entry['prelude']}", "hummel")
    if source == "bach-chorale":
        return fetch_bach_chorale(f"chorale {entry['chorale']}", "bach")
    if source == "art-of-fugue":
        base, _ = CRAIG["art-of-fugue"]
        fname = entry["filename"]
        return _fetch_kern(base, fname, f"bach_{fname.replace('.krn', '')}.musicxml")
    if source == "beethoven-quartets":
        return fetch_beethoven_quartet(
            f"quartet {entry['quartet']} movement {entry['movement']}", "beethoven"
        )
    if source == "music21-corpus":
        return _parse_corpus_path(entry["corpusPath"])
    return None


def match_catalogue(title: str, composer: str = "") -> Optional[Tuple[Path, Dict[str, Any], int]]:
    query = _norm(f"{composer} {title}")
    if not query:
        return None
    best: Tuple[int, Optional[Path], Optional[Dict[str, Any]]] = (0, None, None)
    for entry in build_catalogue():
        score = _title_score(query, entry)
        if _composer_hit(query, entry["composer"]):
            score += 2
        if score < 8:
            continue
        if score > best[0]:
            best = (score, None, entry)
    if best[0] >= 8 and best[2]:
        path = _fetch_from_catalogue_entry(best[2])
        if path:
            return path, best[2], best[0]
    return None


COMPOSER_DEFAULTS = {
    "beethoven": ("Piano Sonata no. 14 \"Moonlight\"", "beethoven", "moonlight"),
    "mozart": ("Piano Sonata no. 16", "mozart", "mozart sonata 16"),
    "chopin": ("Prelude op. 28 no. 15 \"Raindrop\"", "chopin", "raindrop"),
    "bach": ("Prelude in C major, BWV 846", "bach", "bwv 846"),
    "joplin": ("The Entertainer", "joplin", "the entertainer"),
    "schumann": ("Dichterliebe no. 2", "schumann", "dichterliebe"),
    "haydn": ("Piano Sonata Hob. XVI:62 — Movement 1", "haydn", "haydn sonata 62"),
    "scarlatti": ("Keyboard Sonata K.1", "scarlatti", "scarlatti k 1"),
    "hummel": ("Prelude op. 67 no. 1", "hummel", "hummel prelude 1"),
    "clementi": ("Sonatinas (Clementi)", "clementi", "clementi"),
    "traditional": ("Twinkle Twinkle Little Star", "traditional", "twinkle"),
    "liszt": ("Liebestraum no. 3", "liszt", "liebestraum"),
    "debussy": ("Clair de lune", "debussy", "clair de lune"),
    "satie": ("Gymnopédie no. 1", "satie", "gymnopedie"),
    "scriabin": ("Prelude op. 11 no. 1", "scriabin", "scriabin op 11 no 1"),
    "schubert": ("Ave Maria, D.839", "schubert", "ave maria"),
    "brahms": ("Hungarian Dance no. 5", "brahms", "hungarian dance 5"),
}


def resolve_score(title: str, composer: str = "", query: str = "") -> Optional[Dict[str, str]]:
    """Return {path, title, composer, source} or None."""
    title = (title or "").strip()
    composer = (composer or "").strip()
    query = (query or "").strip()

    attempts = [
        (title, composer),
        (query, composer),
        (query, ""),
        (f"{composer} {title}".strip(), ""),
    ]

    for t, c in attempts:
        if not t and not c:
            continue

        matched = match_library(t, c)
        if matched:
            path, entry, _ = matched
            return {
                "path": str(path),
                "title": entry["title"],
                "composer": entry["composer"],
                "source": "library",
            }

        path = _alias_resolve(t, c)
        if path:
            return {
                "path": str(path),
                "title": title or t,
                "composer": composer or c,
                "source": "alias",
            }

        catalogued = match_catalogue(t, c)
        if catalogued:
            path, entry, _ = catalogued
            return {
                "path": str(path),
                "title": entry.get("title") or title or t,
                "composer": entry.get("composer") or composer or c,
                "source": entry.get("source") or "catalogue",
            }

        for fetcher, source in (
            (fetch_beethoven_sonata, "beethoven-sonatas"),
            (fetch_mozart_sonata, "mozart-sonatas"),
            (fetch_haydn_sonata, "haydn-sonatas"),
            (fetch_chopin, "chopin"),
            (fetch_joplin, "joplin"),
            (fetch_scarlatti, "scarlatti"),
            (fetch_hummel, "hummel"),
            (fetch_bach_chorale, "bach-chorale"),
            (fetch_art_of_fugue, "art-of-fugue"),
            (fetch_beethoven_quartet, "beethoven-quartets"),
            (fetch_musetrainer, "musetrainer"),
            (fetch_openscore, "openscore"),
            (fetch_scriabin, "scriabin"),
            (fetch_liszt_kernscores, "kernscores-liszt"),
            (fetch_music21_corpus, "music21-corpus"),
        ):
            path = fetcher(t, c)
            if path:
                return {
                    "path": str(path),
                    "title": title or t,
                    "composer": composer or c,
                    "source": source,
                }

    # Composer-only searches: open a strong free default instead of failing.
    blob = _norm(f"{query} {composer} {title}".strip())
    name_noise = {
        "ludwig", "van", "wolfgang", "amadeus", "frederic", "fryderyk", "francois",
        "johann", "sebastian", "scott", "robert", "alexander", "composer", "joseph",
        "domenico", "muzio", "nepomuk", "franz", "clara", "george", "frideric",
        "claude", "erik", "johannes", "pyotr", "ilyich", "nikolai",
    }
    tokens = set(blob.split())
    for key, (default_title, default_composer, default_query) in COMPOSER_DEFAULTS.items():
        if key not in tokens:
            continue
        if tokens - name_noise - {key}:
            continue
        resolved = resolve_score(default_title, default_composer, query=default_query)
        if resolved:
            resolved = dict(resolved)
            resolved["fallbackNote"] = (
                f"Opened {resolved['title']} — a free public-domain score while browsing {key.title()}."
            )
            return resolved

    return None
