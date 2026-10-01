"""Search and piece overview from free public sources.

Open Opus for classical catalogue metadata; Wikipedia for a short history blurb.
No API key required. Score files still come from the musician (MusicXML / PDF /
photo) or a local sample — we never scrape copyrighted editions.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

OPENOPUS = "https://api.openopus.org"
WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary"
USER_AGENT = "LuneScoreCoach/4.0 (local music practice app)"


def _get_json(url: str, timeout: float = 8.0) -> Optional[Dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None


def search_catalogue(query: str, limit: int = 12) -> List[Dict[str, Any]]:
    cleaned = (query or "").strip()
    if len(cleaned) < 2:
        return []

    encoded = urllib.parse.quote(cleaned)
    data = _get_json(f"{OPENOPUS}/omnisearch/{encoded}/0.json")
    if not data or not data.get("results"):
        return []

    results: List[Dict[str, Any]] = []
    composers: List[Dict[str, Any]] = []
    for row in data["results"]:
        composer = row.get("composer") or {}
        work = row.get("work") or {}
        if not work and composer:
            composers.append(
                {
                    "kind": "composer",
                    "id": f"composer-{composer.get('id')}",
                    "title": composer.get("complete_name") or composer.get("name") or "",
                    "composer": composer.get("complete_name") or composer.get("name") or "",
                    "subtitle": composer.get("epoch") or "",
                    "epoch": composer.get("epoch") or "",
                    "portrait": composer.get("portrait") or "",
                    "imslpQuery": composer.get("complete_name") or composer.get("name") or "",
                }
            )
            continue

        title = work.get("title") or ""
        composer_name = composer.get("complete_name") or composer.get("name") or ""
        results.append(
            {
                "kind": "work",
                "id": f"work-{work.get('id')}",
                "title": title,
                "composer": composer_name,
                "subtitle": work.get("genre") or work.get("subtitle") or "",
                "epoch": composer.get("epoch") or "",
                "portrait": composer.get("portrait") or "",
                "imslpQuery": f"{composer_name} {title}".strip(),
            }
        )
    # Works first — that's what people want to open and dissect.
    return (results + composers)[:limit]


def wikipedia_summary(title: str) -> Dict[str, str]:
    if not title.strip():
        return {}
    encoded = urllib.parse.quote(title.replace(" ", "_"))
    data = _get_json(f"{WIKI}/{encoded}")
    if not data or data.get("type") == "disambiguation":
        return {}
    return {
        "title": data.get("title") or title,
        "extract": (data.get("extract") or "").strip(),
        "url": (data.get("content_urls") or {}).get("desktop", {}).get("page") or "",
    }


def piece_overview(
    title: str = "",
    composer: str = "",
    analysis: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """A short, factual overview — history when available, playing facts from the score."""
    analysis = analysis or {}
    history = {}
    # Prefer composer pages for a clean biography; fall back to the work title.
    for candidate in (composer, f"{title} ({composer})" if title and composer else "", title):
        if not candidate:
            continue
        history = wikipedia_summary(candidate)
        if history.get("extract"):
            break

    playing: List[str] = []
    key = analysis.get("notatedKey") or analysis.get("analyzedKey")
    if key:
        playing.append(f"Written key: {key}.")
    if analysis.get("timeSignature"):
        playing.append(f"Time signature: {analysis['timeSignature']}.")
    if analysis.get("tempo"):
        playing.append(f"Tempo marking: {analysis['tempo']}.")
    measures = analysis.get("measures") or []
    if measures:
        playing.append(f"{len(measures)} bars in this file.")
    dynamics = sorted(
        {
            d.get("text")
            for m in measures
            for d in (m.get("dynamics") or [])
            if d.get("text")
        }
    )
    if dynamics:
        playing.append("Dynamics in the score: " + ", ".join(dynamics[:8]) + ".")

    return {
        "title": title or analysis.get("title") or "Untitled",
        "composer": composer or analysis.get("composer") or "",
        "history": history.get("extract") or "",
        "historyUrl": history.get("url") or "",
        "playing": playing,
        "imslpSearch": (
            f"https://imslp.org/index.php?search={urllib.parse.quote((composer + ' ' + title).strip())}"
            if (composer or title)
            else ""
        ),
    }
