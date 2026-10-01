"""Resolve a searched work to an actual MusicXML score and open it.

Priority:
1. Local public-domain library shipped with Lune
2. music21 corpus (already installed)
3. Live fetch of public-domain Humdrum encodings (craigsapp) → convert to MusicXML

Copyrighted editions are never scraped. If nothing legal is available, return None
so the UI can say so clearly.
"""

from __future__ import annotations

import re
import tempfile
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from music21 import converter, corpus

ROOT = Path(__file__).resolve().parent.parent
LIBRARY = ROOT / "samples" / "library"
CACHE = Path.home() / "Library" / "Application Support" / "Lune" / "score-cache"

# Hand-curated public-domain scores that ship with the app.
LIBRARY_INDEX: List[Dict[str, Any]] = [
    {
        "file": "beethoven_moonlight_mvt1.musicxml",
        "title": 'Piano Sonata no. 14 in C-sharp minor, op. 27 no. 2, "Moonlight"',
        "composer": "Ludwig van Beethoven",
        "keys": ["moonlight", "sonata 14", "sonata no. 14", "op. 27 no. 2", "opus 27", "c sharp minor", "c-sharp minor"],
    },
    {
        "file": "bach_prelude_c.musicxml",
        "title": "Prelude in C major, BWV 846",
        "composer": "Johann Sebastian Bach",
        "keys": ["bwv 846", "bwv846", "prelude in c", "well-tempered", "wtc"],
    },
    {
        "file": "chopin_mazurka.musicxml",
        "title": "Mazurka op. 6 no. 2",
        "composer": "Frédéric Chopin",
        "keys": ["mazurka", "op. 6 no. 2", "opus 6"],
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
        "keys": ["op. 18 no. 1", "opus 18 no. 1", "quartet"],
    },
    {
        "file": "mozart_k155_m1.musicxml",
        "title": "String Quartet K.155 — Movement 1",
        "composer": "Wolfgang Amadeus Mozart",
        "keys": ["k.155", "k155", "k 155"],
    },
    {
        "file": "twinkle.musicxml",
        "title": "Twinkle Twinkle Little Star",
        "composer": "Traditional",
        "keys": ["twinkle", "little star", "abc song"],
    },
]

# Public-domain Humdrum encodings we can fetch and convert on demand.
CRAIGSAPP_BEETHOVEN = (
    "https://raw.githubusercontent.com/craigsapp/beethoven-piano-sonatas/master/kern/"
)


def _norm(text: str) -> str:
    text = (text or "").lower()
    text = text.replace("♯", "sharp").replace("#", "sharp")
    text = text.replace("♭", "flat")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _score(query_title: str, query_composer: str, entry: Dict[str, Any]) -> int:
    q = _norm(f"{query_composer} {query_title}")
    if not q:
        return 0
    points = 0
    title_n = _norm(entry["title"])
    composer_n = _norm(entry["composer"])
    if composer_n and composer_n in q:
        points += 4
    # last name match
    last = composer_n.split()[-1] if composer_n else ""
    if last and last in q:
        points += 3
    for key in entry.get("keys", []):
        if _norm(key) in q:
            points += 5
    # token overlap on title
    title_tokens = set(title_n.split())
    query_tokens = set(q.split())
    overlap = title_tokens & query_tokens
    points += min(6, len(overlap))
    if "moonlight" in q and "moonlight" in title_n:
        points += 10
    return points


def match_library(title: str, composer: str = "") -> Optional[Path]:
    best: Tuple[int, Optional[Path]] = (0, None)
    for entry in LIBRARY_INDEX:
        path = LIBRARY / entry["file"]
        if not path.exists():
            # twinkle may live in samples/
            alt = ROOT / "samples" / entry["file"]
            path = alt if alt.exists() else path
        if not path.exists():
            continue
        points = _score(title, composer, entry)
        if points > best[0]:
            best = (points, path)
    # Need a real match, not a random weak one
    if best[0] >= 6:
        return best[1]
    return None


def _cache_dir() -> Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    return CACHE


def fetch_beethoven_sonata(title: str, composer: str) -> Optional[Path]:
    blob = _norm(f"{composer} {title}")
    if "beethoven" not in blob and "ludwig" not in blob:
        return None
    # Sonata number
    match = re.search(r"sonata(?:\s+no\.?)?\s*(\d{1,2})", blob)
    num = None
    if match:
        num = int(match.group(1))
    if "moonlight" in blob:
        num = 14
    if num is None:
        return None
    if num < 1 or num > 32:
        return None

    cached = _cache_dir() / f"beethoven_sonata{num:02d}-1.musicxml"
    if cached.exists() and cached.stat().st_size > 1000:
        return cached

    url = f"{CRAIGSAPP_BEETHOVEN}sonata{num:02d}-1.krn"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            raw = response.read()
    except Exception:
        return None

    with tempfile.NamedTemporaryFile(suffix=".krn", delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name
    try:
        score = converter.parse(tmp_path)
        score.write("musicxml", fp=str(cached))
        return cached if cached.exists() else None
    except Exception:
        return None
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def fetch_music21_corpus(title: str, composer: str) -> Optional[Path]:
    """Best-effort match inside the installed music21 corpus."""
    queries = []
    last = (composer or "").split()[-1] if composer else ""
    if last:
        queries.append(last)
    if title:
        # opus / BWV / K numbers are the most reliable corpus keys
        for pattern in (
            r"bwv\s*\d+",
            r"op(?:us|\.)?\s*\d+",
            r"\bk\.?\s*\d+",
        ):
            found = re.search(pattern, title, re.I)
            if found:
                queries.append(found.group(0))
        queries.append(title.split(",")[0][:40])

    hit_path = None
    for q in queries:
        try:
            hits = corpus.search(q)
        except Exception:
            continue
        for hit in hits[:8]:
            source = str(getattr(hit, "sourcePath", "") or "")
            if not source:
                continue
            # Prefer mxl/xml over abc dumps
            if source.endswith((".abc",)):
                continue
            if last and last.lower() not in source.lower() and last.lower() not in _norm(
                str(getattr(hit.metadata, "composer", "") or "")
            ):
                # still allow strong title hits
                if _norm(q) not in _norm(source):
                    continue
            hit_path = source
            break
        if hit_path:
            break

    if not hit_path:
        return None

    cached = _cache_dir() / f"corpus_{re.sub(r'[^a-zA-Z0-9]+', '_', hit_path)[-80:]}.musicxml"
    if cached.exists() and cached.stat().st_size > 500:
        return cached
    try:
        score = corpus.parse(hit_path)
        score.write("musicxml", fp=str(cached))
        return cached
    except Exception:
        return None


def resolve_score(title: str, composer: str = "") -> Optional[Dict[str, str]]:
    """Return {path, title, composer, source} or None."""
    path = match_library(title, composer)
    if path:
        return {
            "path": str(path),
            "title": title,
            "composer": composer,
            "source": "library",
        }

    path = fetch_beethoven_sonata(title, composer)
    if path:
        return {
            "path": str(path),
            "title": title,
            "composer": composer or "Ludwig van Beethoven",
            "source": "beethoven-sonatas",
        }

    path = fetch_music21_corpus(title, composer)
    if path:
        return {
            "path": str(path),
            "title": title,
            "composer": composer,
            "source": "music21-corpus",
        }

    return None
