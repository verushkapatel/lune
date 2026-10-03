"""Allowlisted free MusicXML fetch for server /api/search/open.

Reads frontend/remote-catalog.json (built by scripts/build_remote_catalog.py).
Only https hosts on the allowlist. MusicXML/MXL only — never PDF. No paid APIs.
"""

from __future__ import annotations

import json
import re
import tempfile
import unicodedata
import urllib.request
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "frontend" / "remote-catalog.json"
USER_AGENT = "LuneRemoteFetch/1.0 (+https://lune.page/; free open scores only)"

SOURCE_CREDITS: Dict[str, Dict[str, str]] = {
    "musetrainer": {
        "source": "musetrainer/library",
        "sourceUrl": "https://github.com/musetrainer/library",
        "license": "Public-domain / open source edition",
        "licenseUrl": "https://github.com/musetrainer/library",
    },
    "openscore": {
        "source": "OpenScore",
        "sourceUrl": "https://github.com/OpenScore",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openscore-lieder": {
        "source": "OpenScore Lieder",
        "sourceUrl": "https://github.com/OpenScore/Lieder",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "openscore-quartets": {
        "source": "OpenScore String Quartets",
        "sourceUrl": "https://github.com/OpenScore/StringQuartets",
        "license": "CC0 1.0",
        "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/",
    },
    "mutopia": {
        "source": "Mutopia Project",
        "sourceUrl": "https://www.mutopiaproject.org/",
        "license": "Creative Commons / public domain (per piece)",
        "licenseUrl": "https://www.mutopiaproject.org/legal.html",
    },
    "wikimedia": {
        "source": "Wikimedia Commons",
        "sourceUrl": "https://commons.wikimedia.org/",
        "license": "Public domain / free license (per file)",
        "licenseUrl": "https://commons.wikimedia.org/wiki/Commons:Licensing",
    },
    "library": {
        "source": "Lune free library",
        "sourceUrl": "https://lune.page/",
        "license": "Public-domain / open licence of the source edition",
        "licenseUrl": "",
    },
    "beethoven-sonatas": {
        "source": "Craig Sapp Humdrum (Beethoven)",
        "sourceUrl": "https://github.com/craigsapp/beethoven-piano-sonatas",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "mozart-sonatas": {
        "source": "Craig Sapp Humdrum (Mozart)",
        "sourceUrl": "https://github.com/craigsapp/mozart-piano-sonatas",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "haydn-sonatas": {
        "source": "Craig Sapp Humdrum (Haydn)",
        "sourceUrl": "https://github.com/craigsapp/haydn-piano-sonatas",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "chopin": {
        "source": "Craig Sapp Humdrum (Chopin)",
        "sourceUrl": "https://github.com/craigsapp/chopin-first-editions",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "joplin": {
        "source": "Craig Sapp Humdrum (Joplin)",
        "sourceUrl": "https://github.com/craigsapp/joplin",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "scarlatti": {
        "source": "Craig Sapp Humdrum (Scarlatti)",
        "sourceUrl": "https://github.com/craigsapp/scarlatti-keyboard-sonatas",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "scriabin": {
        "source": "Craig Sapp Humdrum (Scriabin)",
        "sourceUrl": "https://github.com/craigsapp/scriabin",
        "license": "CC BY-NC-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    },
    "music21-corpus": {
        "source": "music21 corpus",
        "sourceUrl": "https://github.com/cuthbertLab/music21",
        "license": "Open corpus (see music21)",
        "licenseUrl": "https://github.com/cuthbertLab/music21",
    },
}


def _norm(text: str) -> str:
    t = unicodedata.normalize("NFD", text or "")
    t = "".join(c for c in t if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", " ", t).strip()


@lru_cache(maxsize=1)
def load_catalog() -> Dict[str, Any]:
    if not CATALOG_PATH.exists():
        return {"items": [], "allowlistHosts": ["raw.githubusercontent.com"], "credits": SOURCE_CREDITS}
    try:
        data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"items": [], "allowlistHosts": ["raw.githubusercontent.com"], "credits": SOURCE_CREDITS}
    if not isinstance(data, dict):
        return {"items": [], "allowlistHosts": ["raw.githubusercontent.com"], "credits": SOURCE_CREDITS}
    data.setdefault("allowlistHosts", ["raw.githubusercontent.com"])
    data.setdefault("credits", SOURCE_CREDITS)
    data.setdefault("items", [])
    return data


def host_allowed(url: str, allowlist: Optional[List[str]] = None) -> bool:
    try:
        u = urlparse(url)
    except Exception:
        return False
    if u.scheme != "https":
        return False
    hosts = allowlist or load_catalog().get("allowlistHosts") or ["raw.githubusercontent.com"]
    return (u.hostname or "") in hosts


def credit_for_source(source: str, url: str = "") -> Dict[str, str]:
    cat = load_catalog()
    credits = {**SOURCE_CREDITS, **(cat.get("credits") or {})}
    key = (source or "").lower().replace(" ", "-")
    base = dict(credits.get(key) or credits.get(source) or {})
    if not base:
        pretty = source or "Open free source"
        base = {
            "source": pretty,
            "sourceUrl": url or "",
            "license": "Open / public-domain edition",
            "licenseUrl": "",
        }
    if url and not base.get("sourceUrl"):
        base["sourceUrl"] = url
    return base


def _score_entry(needle: str, entry: Dict[str, Any], composer_needle: str = "") -> int:
    if not needle:
        return 0
    title = _norm(entry.get("title") or "")
    composer = _norm(entry.get("composer") or "")
    query = _norm(entry.get("query") or "")
    hay = _norm(entry.get("hay") or f"{entry.get('title')} {entry.get('composer')} {entry.get('query')}")
    s = 0
    if query and (needle == query or query in needle or needle in query):
        s += 28
    if title and (needle == title or title in needle or needle in title):
        s += 22
    if composer and composer in needle:
        s += 6
    if needle in hay:
        s += 10
    words = [w for w in needle.split() if len(w) > 2]
    if words:
        hits = sum(1 for w in words if w in hay)
        s += round((hits / len(words)) * 12)
    if composer_needle and composer_needle in composer:
        s += 4
    return s


def match_remote(title: str = "", composer: str = "", query: str = "") -> Optional[Dict[str, Any]]:
    cat = load_catalog()
    needle = _norm(query or title or "")
    if not needle:
        return None
    c_needle = _norm(composer)
    best = None
    best_score = 0
    for entry in cat.get("items") or []:
        score = _score_entry(needle, entry, c_needle)
        if score > best_score:
            best_score = score
            best = entry
    if not best or best_score < 10:
        return None
    url = best.get("url") or ""
    if not host_allowed(url, cat.get("allowlistHosts")):
        return None
    return best


def fetch_remote_bytes(url: str) -> bytes:
    cat = load_catalog()
    if not host_allowed(url, cat.get("allowlistHosts")):
        raise ValueError("Source not allowlisted")
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.recordare.musicxml+xml,application/xml,text/xml,*/*"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        data = resp.read()
    if len(data) < 200:
        raise ValueError("Empty score")
    sniff = data[:80].decode("utf-8", "ignore").lower()
    if "<!doctype" in sniff or "<html" in sniff:
        raise ValueError("Not a score file")
    # Refuse PDF magic
    if data[:4] == b"%PDF":
        raise ValueError("PDF not allowed")
    return data


def open_remote_piece(title: str = "", composer: str = "", query: str = "") -> Optional[Dict[str, Any]]:
    """Match allowlisted catalog, download MusicXML/MXL to a temp path, return resolve-like dict + credit."""
    entry = match_remote(title=title, composer=composer, query=query)
    if not entry:
        return None
    url = entry["url"]
    raw = fetch_remote_bytes(url)
    suffix = ".mxl" if url.lower().endswith(".mxl") or raw[:2] == b"PK" else ".musicxml"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp.write(raw)
    tmp.close()
    credit = entry.get("credit") or credit_for_source(entry.get("source") or "", url)
    return {
        "path": tmp.name,
        "title": entry.get("title") or title or query,
        "composer": entry.get("composer") or composer or "",
        "source": entry.get("source") or "remote",
        "credit": {
            "source": credit.get("source") or "",
            "sourceUrl": credit.get("sourceUrl") or url,
            "license": credit.get("license") or "",
            "licenseUrl": credit.get("licenseUrl") or "",
        },
        "remoteFetched": True,
        "id": entry.get("id") or "",
    }
