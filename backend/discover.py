"""Search and rich piece/composer overviews from free public sources."""

from __future__ import annotations

import json
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

OPENOPUS = "https://api.openopus.org"
WIKI = "https://en.wikipedia.org/api/rest_v1/page/summary"
USER_AGENT = "LuneScoreCoach/5.0 (local music practice app)"

# Local portraits under frontend/assets/composers/ — served at /static/...
# Prefer these over Wikipedia/OpenOpus hotlinks so faces never depend on remote thumbs.
LOCAL_COMPOSER_FACES: Dict[str, str] = {
    "chopin": "chopin.jpg",
    "beethoven": "beethoven.jpg",
    "bach": "bach.jpg",
    "mozart": "mozart.jpg",
    "debussy": "debussy.jpg",
    "liszt": "liszt.jpg",
    "schubert": "schubert.jpg",
    "schumann": "schumann.jpg",
    "brahms": "brahms.jpg",
    "tchaikovsky": "tchaikovsky.jpg",
    "joplin": "joplin.jpg",
    "satie": "satie.jpg",
    "haydn": "haydn.jpg",
    "handel": "handel.jpg",
    "rimsky": "rimsky.jpg",
    "rimsky-korsakov": "rimsky.jpg",
}
LOCAL_FACE_CACHE_BUST = "fix50"


def local_composer_face_url(composer: str) -> str:
    """Return a stable /static portrait URL for a known composer, else empty."""
    n = (composer or "").lower()
    # Strip combining accents so "Frédéric" still matches.
    n = "".join(
        ch for ch in unicodedata.normalize("NFD", n) if unicodedata.category(ch) != "Mn"
    )
    if not n:
        return ""
    if "rimsky" in n:
        key = "rimsky"
    else:
        key = ""
        for candidate in sorted(LOCAL_COMPOSER_FACES, key=len, reverse=True):
            if candidate in n:
                key = candidate
                break
        if not key:
            last = n.strip().split()[-1] if n.strip() else ""
            key = last if last in LOCAL_COMPOSER_FACES else ""
    file = LOCAL_COMPOSER_FACES.get(key) or ""
    if not file:
        return ""
    return f"/static/assets/composers/{file}?v={LOCAL_FACE_CACHE_BUST}"

ERA_STORIES: Dict[str, str] = {
    "medieval": (
        "Music lived in churches and courts. Melody often moved in long chant-like lines, "
        "and harmony was still finding its voice."
    ),
    "renaissance": (
        "Voices weave around each other like threads in cloth. Balance, purity of sound, "
        "and careful counterpoint matter more than big romantic drama."
    ),
    "baroque": (
        "Ornament, drive, and clear bass lines. Think dance rhythms, terraced dynamics "
        "(sudden soft/loud), and melodies that keep spinning forward."
    ),
    "classical": (
        "Clarity, elegant proportions, and conversation between phrases. Themes are easy "
        "to follow — then they get playfully changed and returned."
    ),
    "early romantic": (
        "Personal feeling steps forward. Rubato, dramatic contrasts, and singing melodies "
        "on the piano become part of the language."
    ),
    "romantic": (
        "Emotion, colour, and storytelling. Expect sweeping lines, rich harmony, and "
        "moments that feel like scenes from a novel."
    ),
    "late romantic": (
        "Harmony stretches further; textures grow denser. Pieces can feel cinematic — "
        "long arcs of tension and release."
    ),
    "20th century": (
        "Rules get rewritten. Some music is folk-simple, some is crunchy and modern — "
        "listen for new colours, rhythms, and atmospheres."
    ),
    "modern": (
        "Anything goes: jazz colours, folk tunes, film-like scenes, or stark minimalism. "
        "Ask what mood the composer wants in each section."
    ),
}


def _get_json(url: str, timeout: float = 10.0) -> Optional[Dict[str, Any]]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return None


# Short-lived cache so repeat /api/search calls do not re-hit OpenOpus.
_OPENOPUS_CACHE: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
_OPENOPUS_TTL_SEC = 300.0


def search_catalogue(query: str, limit: int = 16) -> List[Dict[str, Any]]:
    cleaned = (query or "").strip()
    if len(cleaned) < 2:
        return []

    cache_key = cleaned.lower()
    now = time.monotonic()
    cached = _OPENOPUS_CACHE.get(cache_key)
    if cached and now - cached[0] < _OPENOPUS_TTL_SEC:
        return list(cached[1])[:limit]

    encoded = urllib.parse.quote(cleaned)
    # Keep remote enrichment snappy; typed search should not wait on this path.
    data = _get_json(f"{OPENOPUS}/omnisearch/{encoded}/0.json", timeout=2.5)
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
    merged = (results + composers)[:limit]
    _OPENOPUS_CACHE[cache_key] = (now, merged)
    if len(_OPENOPUS_CACHE) > 256:
        # Drop oldest half when the cache grows large.
        for stale in sorted(_OPENOPUS_CACHE, key=lambda k: _OPENOPUS_CACHE[k][0])[
            : len(_OPENOPUS_CACHE) // 2
        ]:
            _OPENOPUS_CACHE.pop(stale, None)
    return list(merged)


def wikipedia_summary(title: str, timeout: float = 1.5) -> Dict[str, str]:
    if not title.strip():
        return {}
    encoded = urllib.parse.quote(title.replace(" ", "_"))
    data = _get_json(f"{WIKI}/{encoded}", timeout=timeout)
    if not data or data.get("type") == "disambiguation":
        return {}
    thumb = (data.get("thumbnail") or {}).get("source") or ""
    return {
        "title": data.get("title") or title,
        "extract": (data.get("extract") or "").strip(),
        "url": (data.get("content_urls") or {}).get("desktop", {}).get("page") or "",
        "image": thumb,
    }


def _era_key(epoch: str) -> str:
    e = (epoch or "").lower()
    for key in ERA_STORIES:
        if key in e:
            return key
    if "romanti" in e:
        return "romantic"
    if "classic" in e:
        return "classical"
    if "baroq" in e:
        return "baroque"
    return ""


def _era_blurb(epoch: str) -> Dict[str, str]:
    key = _era_key(epoch)
    label = epoch or (key.title() if key else "Unknown era")
    story = ERA_STORIES.get(key) or (
        f"This work is usually placed in the {label} world. "
        "Listen for how phrasing, dynamics, and touch feel compared with music you already know."
        if epoch
        else "Era not listed — use the history and composer story to place the piece in time."
    )
    tips = {
        "baroque": ["Keep the pulse steady.", "Ornaments should sparkle, not smear.", "Bass line = your compass."],
        "classical": ["Shape clear question–answer phrases.", "Save big drama for true climaxes.", "Light fingers, singing tone."],
        "early romantic": ["Let the melody breathe.", "Balance heart with a steady left hand.", "Colour the harmony softly."],
        "romantic": ["Follow the long line.", "Dynamic waves, not flat grey.", "Pedal for glow, not mud."],
        "late romantic": ["Plan the big arcs.", "Voices inside chords still need to sing.", "Don’t rush the quiet."],
        "20th century": ["Trust odd colours.", "Rhythm can be the main character.", "Silence counts."],
    }.get(key, ["Find the singing line.", "Mark one mood word for each section.", "Slow practice first."])
    return {"label": label, "story": story, "tips": tips, "key": key}


COMPOSER_FALLBACKS: Dict[str, Dict[str, str]] = {
    "beethoven": {
        "hook": "Beethoven stretched classical clarity into stormy personal drama.",
        "bio": (
            "Ludwig van Beethoven (1770–1827) began as a dazzling pianist in Vienna and became "
            "one of the most influential composers in Western music. His middle and late works "
            "push rhythm, harmony, and form while staying deeply human — even as he lost his hearing. "
            "When you practise Beethoven, listen for bold contrasts: sudden softs, fierce accents, "
            "and long arcs that feel like a story."
        ),
        "era": "Early Romantic",
    },
    "mozart": {
        "hook": "Mozart makes elegance sound easy — every phrase is a clear conversation.",
        "bio": (
            "Wolfgang Amadeus Mozart (1756–1791) was a child prodigy who wrote with sparkling clarity. "
            "His piano music loves balanced phrases, graceful melodies, and witty surprises. "
            "Play Mozart with clean fingers, singing tone, and shapes that feel like questions and answers."
        ),
        "era": "Classical",
    },
    "chopin": {
        "hook": "Chopin wrote the piano’s private poetry — rubato, colour, and singing lines.",
        "bio": (
            "Frédéric Chopin (1810–1849) was a Polish pianist-composer who made the piano sound intimate. "
            "Mazurkas dance with a lifted beat; preludes are mood rooms; melodies should speak like a voice. "
            "Keep the left hand calm support while the right hand sings."
        ),
        "era": "Romantic",
    },
    "bach": {
        "hook": "Bach builds beauty from clear lines that weave together.",
        "bio": (
            "Johann Sebastian Bach (1685–1750) shaped Baroque counterpoint into music that still trains "
            "every serious pianist. Listen for independent voices, steady pulse, and ornaments that sparkle "
            "without rushing. In preludes, let patterns bloom; in chorales, hear every voice."
        ),
        "era": "Baroque",
    },
    "schumann": {
        "hook": "Schumann’s music feels like diary pages — poetic, sudden, deeply personal.",
        "bio": (
            "Robert Schumann (1810–1856) poured literary imagination into piano and song. "
            "Expect shifting moods, warm harmony, and lines that want to speak. Shape phrases as if telling a short story."
        ),
        "era": "Romantic",
    },
    "joplin": {
        "hook": "Joplin’s rags stride and sparkle — steady left hand, cheeky right hand.",
        "bio": (
            "Scott Joplin (c.1867–1917) helped define ragtime: a marching left-hand stride under a syncopated "
            "right-hand tune. Keep the bounce honest and the melody playful, never rushed into a blur."
        ),
        "era": "20th Century",
    },
    "traditional": {
        "hook": "Folk tunes are teachers — clear melody, simple harmony, strong memory.",
        "bio": (
            "Traditional melodies travelled by ear long before they were printed. "
            "Play them with clear letter names, steady pulse, and a tune you could sing."
        ),
        "era": "Folk",
    },
}

COMPOSER_ERA_DEFAULTS = {
    "beethoven": "Early Romantic",
    "mozart": "Classical",
    "chopin": "Romantic",
    "bach": "Baroque",
    "schumann": "Romantic",
    "joplin": "20th Century",
    "debussy": "20th Century",
    "haydn": "Classical",
    "handel": "Baroque",
    "schubert": "Early Romantic",
}


def _composer_key(name: str) -> str:
    n = (name or "").lower()
    for key in COMPOSER_FALLBACKS:
        if key in n:
            return key
    last = n.split()[-1] if n else ""
    return last


def _composer_card(composer: str, portrait: str = "", remote: bool = True) -> Dict[str, Any]:
    if not composer.strip():
        # still return a usable empty-safe card
        return {
            "name": "Composer",
            "hook": "Every piece has a human behind it.",
            "bio": "Search a composer name to load their story, portrait, and era tips.",
            "full": "Search a composer name to load their story, portrait, and era tips.",
            "url": "",
            "image": portrait or "",
            "highlights": ["Open the score and listen before you analyse."],
        }

    wiki: Dict[str, str] = {}
    if remote:
        wiki = wikipedia_summary(composer)
        # Try last name alone if full name fails
        if not wiki.get("extract"):
            last = composer.split()[-1]
            if last and last.lower() != composer.lower():
                wiki = wikipedia_summary(last) or wiki

    key = _composer_key(composer)
    fallback = COMPOSER_FALLBACKS.get(key, {})
    local = local_composer_face_url(composer)
    # Prefer local cached faces; remote portrait/wiki only as last resort.
    image = local or portrait or wiki.get("image") or ""
    extract = wiki.get("extract") or fallback.get("bio") or (
        f"{composer} wrote music that pianists still learn from today. "
        "Use the era tips and the score itself to decide touch, tempo, and character."
    )
    sentences = [s.strip() for s in extract.replace("\n", " ").split(". ") if s.strip()]
    hook = fallback.get("hook") or ""
    body = extract
    if sentences:
        hook = hook or (sentences[0].rstrip(".") + ".")
        if len(sentences) > 1:
            body = ". ".join(sentences[1:])
            if body and not body.endswith("."):
                body += "."
    if not hook:
        hook = f"{composer} — listen for their personality in every phrase."
    return {
        "name": composer,
        "hook": hook,
        "bio": body or extract,
        "full": extract,
        "url": wiki.get("url") or "",
        "image": image,
        "highlights": _composer_highlights(composer, extract),
    }


def _composer_highlights(composer: str, extract: str) -> List[str]:
    bits: List[str] = []
    low = (extract or "").lower()
    name = composer.split()[-1] if composer else "This composer"
    if "pianist" in low or "piano" in low:
        bits.append(f"{name} is closely tied to the piano — tone and touch are part of the story.")
    if "violin" in low:
        bits.append("String writing and singing lines often matter in this music.")
    if "deaf" in low or "hearing" in low:
        bits.append("Late works were written through enormous personal struggle — listen for bold contrasts.")
    if "child" in low or "prodigy" in low:
        bits.append("A prodigy story sits behind the notes — clarity and brilliance arrive early.")
    if not bits:
        bits.append("Read the biography slowly, then listen for one trait of their personality in the score.")
    return bits[:3]


def _work_highlights(title: str, history: str, era: str) -> List[str]:
    out: List[str] = []
    h = (history or "").lower()
    t = (title or "").lower()
    if "moonlight" in t or "moonlight" in h:
        out.append("The nickname “Moonlight” came later — play the opening as quiet story-telling, not a march.")
    if "elise" in t:
        out.append("Famous for a reason: keep the right-hand tune speaking while the left stays calm.")
    if "prelude" in t:
        out.append("Preludes are mood rooms — decide the colour of this room before you start.")
    if "mazurka" in t:
        out.append("A mazurka dances with a lifted second or third beat — feel the Polish accent.")
    if "sonata" in t:
        out.append("Sonatas are journeys: notice how the opening idea returns changed.")
    if "rag" in t or "entertainer" in t or "maple" in t:
        out.append("Ragtime strides in the left hand — keep that bounce steady under a cheeky right hand.")
    if not out and era:
        out.append(f"Place every phrase in the {era} sound-world: how would someone from that time shape it?")
    if not out:
        out.append("Before practising notes, say one sentence: what is this piece trying to say?")
    return out[:4]


def piece_overview(
    title: str = "",
    composer: str = "",
    analysis: Optional[Dict[str, Any]] = None,
    epoch: str = "",
    portrait: str = "",
    remote: bool = True,
) -> Dict[str, Any]:
    """Immersive overview: work story, era, composer, and score facts.

    remote=False skips Wikipedia (local fallbacks only) — use for snappy search→Discover.
    """
    analysis = analysis or {}

    work_history: Dict[str, str] = {}
    if remote:
        for candidate in (
            f"{title} ({composer})" if title and composer else "",
            f"{title} {composer}".strip(),
            title,
        ):
            if not candidate:
                continue
            work_history = wikipedia_summary(candidate)
            # Avoid landing on pure composer page when we asked for a work
            if work_history.get("extract"):
                if composer and work_history.get("title", "").lower() == composer.lower():
                    continue
                break

    era = (epoch or "").strip()
    if not era:
        era = COMPOSER_ERA_DEFAULTS.get(_composer_key(composer), "") or (
            COMPOSER_FALLBACKS.get(_composer_key(composer), {}).get("era") or ""
        )
    era_info = _era_blurb(era)
    composer_card = _composer_card(composer, portrait=portrait, remote=remote)

    playing: List[Dict[str, str]] = []
    key = analysis.get("notatedKey") or analysis.get("analyzedKey")
    if key:
        playing.append({"label": "Key", "value": key})
    if analysis.get("timeSignature"):
        playing.append({"label": "Time", "value": analysis["timeSignature"]})
    if analysis.get("tempo"):
        playing.append({"label": "Tempo", "value": analysis["tempo"]})
    measures = analysis.get("measures") or []
    if measures:
        playing.append({"label": "Bars", "value": str(len(measures))})
    dynamics = sorted(
        {
            d.get("text")
            for m in measures
            for d in (m.get("dynamics") or [])
            if d.get("text")
        }
    )
    if dynamics:
        playing.append({"label": "Dynamics", "value": ", ".join(dynamics[:8])})
    if not playing:
        playing.append({"label": "Score", "value": "Open the piece to read key, metre, and tempo from the file."})

    hard = analysis.get("hardSpots") or []
    hard_lines = [
        f"Bar {h.get('measure')}: " + ", ".join(h.get("reasons") or [])
        for h in hard[:5]
        if h.get("measure")
    ]
    if not hard_lines and measures:
        hard_lines = ["Click bars on the score to uncover what needs slow practice."]

    history_text = work_history.get("extract") or ""
    if (
        history_text
        and composer_card.get("full")
        and history_text.strip() == composer_card.get("full", "").strip()
    ):
        history_text = ""
    if not history_text:
        # Always give a readable piece story — never leave this blank.
        bits = [summary_bit for summary_bit in [
            f"{title or 'This piece'} is ready to explore on Lune.",
            f"It is associated with {composer}." if composer else "",
            f"Stylistically it sits in the {era} world." if era else "",
            "Start by listening, then ask about the bars that surprise your hands.",
        ] if summary_bit]
        history_text = " ".join(bits)
        # Enrich with highlights as prose
        highs = _work_highlights(title, "", era)
        if highs:
            history_text += " " + " ".join(highs[:2])

    summary = ""
    if era and composer:
        summary = f"{title or 'This work'} belongs to the {era} era — music by {composer}."
    elif composer:
        summary = f"{title or 'This work'}, by {composer}."
    else:
        summary = title or "A piece to explore."

    chapters = []
    chapters.append({"id": "hook", "title": "First glance", "body": summary})
    chapters.append({"id": "story", "title": "The story of the piece", "body": history_text})
    chapters.append(
        {
            "id": "era",
            "title": f"Era · {era_info['label']}",
            "body": era_info["story"],
            "tips": era_info.get("tips") or [],
        }
    )
    chapters.append(
        {
            "id": "composer",
            "title": f"About {composer_card.get('name') or composer or 'the composer'}",
            "body": composer_card.get("full") or composer_card.get("hook") or "",
            "hook": composer_card.get("hook") or "",
            "highlights": composer_card.get("highlights") or [],
            "image": composer_card.get("image") or "",
        }
    )

    return {
        "title": title or analysis.get("title") or "Untitled",
        "composer": composer or analysis.get("composer") or "",
        "era": era,
        "epoch": era,
        "summary": summary,
        "history": history_text,
        "historyUrl": work_history.get("url") or "",
        "historyImage": work_history.get("image") or "",
        "highlights": _work_highlights(title, history_text, era),
        "eraInfo": era_info,
        "composerInfo": composer_card,
        "chapters": chapters,
        "playing": [f"{p['label']}: {p['value']}" for p in playing],
        "playingCards": playing,
        "hardSpots": hard_lines,
        "imslpSearch": (
            f"https://imslp.org/index.php?search={urllib.parse.quote((composer + ' ' + title).strip())}"
            if (composer or title)
            else ""
        ),
    }
