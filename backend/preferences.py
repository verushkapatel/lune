"""Per-user preferences.

These are not decoration: every field here either changes the instructions the
model receives, the way the fingering solver models the hand, or how much of a
long score gets analysed in detail.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

CHOICES: Dict[str, List[str]] = {
    "instrument": [
        "piano",
        "guitar",
        "violin",
        "viola",
        "cello",
        "flute",
        "clarinet",
        "voice",
        "general",
    ],
    "level": ["beginner", "intermediate", "advanced", "professional"],
    "noteNames": ["letters", "solfege", "german"],
    "handSpan": ["small", "medium", "large"],
    "verbosity": ["concise", "balanced", "detailed"],
    "provider": ["auto", "openai", "anthropic"],
    "textSize": ["small", "medium", "large"],
}

DEFAULTS: Dict[str, Any] = {
    "instrument": "piano",
    "level": "intermediate",
    "noteNames": "letters",
    "handSpan": "medium",
    "verbosity": "balanced",
    "provider": "auto",
    "model": "",
    "textSize": "medium",
    "romanNumerals": True,
    "alwaysFingering": False,
    "practiceTips": True,
    "detailBars": 80,
    "sendOnEnter": True,
}

DETAIL_BARS_RANGE = (10, 400)

INSTRUMENT_GUIDANCE = {
    "piano": "The user plays piano. Fingering means finger numbers 1-5 in each hand.",
    "guitar": (
        "The user plays guitar. Fingering means left-hand fingers 1-4 plus string and "
        "fret positions; never give piano finger numbers. Mention position shifts."
    ),
    "violin": (
        "The user plays violin. Fingering means left-hand fingers 1-4 with an open "
        "string as 0; mention positions and shifts, and bowing where relevant."
    ),
    "viola": (
        "The user plays viola. Read alto clef by default. Fingering means left-hand "
        "fingers 1-4 with an open string as 0; mention positions and bowing."
    ),
    "cello": (
        "The user plays cello. Read bass clef by default, and tenor or treble when "
        "the music sits high. Mention positions, extensions, and thumb position."
    ),
    "flute": (
        "The user plays flute. Fingering means the standard flute fingering chart, "
        "including alternate and trill fingerings. Mention breathing points."
    ),
    "clarinet": (
        "The user plays clarinet. Mention register breaks, alternate fingerings, and "
        "that written pitch differs from concert pitch on a B-flat instrument."
    ),
    "voice": (
        "The user is a singer. Prioritise text, breath, tessitura, and vowel shaping "
        "over any kind of fingering."
    ),
    "general": "The user has not named one instrument, so keep advice instrument-neutral.",
}

LEVEL_GUIDANCE = {
    "beginner": (
        "Assume little theory background. Define terms in plain language the first "
        "time they appear, and keep to one idea at a time."
    ),
    "intermediate": (
        "Assume they read notation fluently and know basic harmony, but explain "
        "anything beyond diatonic theory."
    ),
    "advanced": (
        "Assume solid theory and technique. Use standard terminology without "
        "stopping to define it."
    ),
    "professional": (
        "Assume conservatoire-level knowledge. Be direct and technical, skip "
        "basics entirely, and engage with interpretive nuance."
    ),
}

NOTE_NAME_GUIDANCE = {
    "letters": "Name pitches with letters (C, D, E, F#, Bb).",
    "solfege": (
        "Name pitches with fixed-do solfege (do, re, mi, fa, sol, la, si), giving the "
        "letter name in brackets on first mention of each pitch."
    ),
    "german": (
        "Name pitches with German note names, where B natural is H and B flat is B. "
        "Use -is for sharps and -es for flats (Cis, Es)."
    ),
}

VERBOSITY_GUIDANCE = {
    "concise": "Answer in as few words as the question allows. Prefer a short list to prose.",
    "balanced": "Give a complete answer without padding. A few sentences is usually right.",
    "detailed": (
        "Give thorough answers with reasoning, context, and worked examples where "
        "they genuinely help."
    ),
}

# How far the modelled hand can open, relative to the default span table.
HAND_SPAN_SCALE = {"small": 0.82, "medium": 1.0, "large": 1.18}


def normalise(raw: Dict[str, Any]) -> Dict[str, Any]:
    """Merge stored preferences over the defaults, discarding anything invalid."""
    prefs = dict(DEFAULTS)
    if not isinstance(raw, dict):
        return prefs

    for field, options in CHOICES.items():
        value = raw.get(field)
        if isinstance(value, str) and value in options:
            prefs[field] = value

    for field in ("romanNumerals", "alwaysFingering", "practiceTips", "sendOnEnter"):
        if isinstance(raw.get(field), bool):
            prefs[field] = raw[field]

    model = raw.get("model")
    if isinstance(model, str):
        prefs["model"] = model.strip()[:80]

    bars = raw.get("detailBars")
    if isinstance(bars, bool):
        bars = None
    if isinstance(bars, (int, float)):
        low, high = DETAIL_BARS_RANGE
        prefs["detailBars"] = max(low, min(high, int(bars)))

    return prefs


def hand_span(prefs: Dict[str, Any]) -> str:
    return prefs.get("handSpan", "medium")


def detail_bars(prefs: Dict[str, Any]) -> int:
    return int(prefs.get("detailBars", DEFAULTS["detailBars"]))


def preferences_prompt(prefs: Dict[str, Any], display_name: str = "") -> str:
    """The instruction block appended to the system prompt for this user."""
    prefs = normalise(prefs)
    lines: List[str] = []

    if display_name.strip():
        lines.append(f"You are speaking with {display_name.strip()}.")

    lines.append(INSTRUMENT_GUIDANCE.get(prefs["instrument"], INSTRUMENT_GUIDANCE["general"]))
    lines.append(LEVEL_GUIDANCE[prefs["level"]])
    lines.append(NOTE_NAME_GUIDANCE[prefs["noteNames"]])
    lines.append(VERBOSITY_GUIDANCE[prefs["verbosity"]])

    if prefs["instrument"] == "piano":
        span = prefs["handSpan"]
        if span == "small":
            lines.append(
                "They have a small hand span, so avoid fingerings and voicings that "
                "need more than an octave, and suggest rolling or redistributing "
                "wide chords between the hands."
            )
        elif span == "large":
            lines.append(
                "They have a large hand span, so wide stretches up to a tenth are "
                "available without redistribution."
            )

    if not prefs["romanNumerals"]:
        lines.append(
            "Do not use Roman numeral analysis unless they ask for it; describe "
            "harmony with chord names instead."
        )

    if prefs["alwaysFingering"]:
        lines.append(
            "Whenever they attach a score, include suggested fingering even if they "
            "did not ask for it."
        )

    if not prefs["practiceTips"]:
        lines.append("Do not add practice suggestions unless they ask for them.")

    return "\n\n## THIS USER\n\n" + "\n".join(f"- {line}" for line in lines) + "\n"


def resolve_model(prefs: Dict[str, Any], key_provider: str) -> Tuple[str, str]:
    """The provider and model this user's settings call for."""
    prefs = normalise(prefs)
    provider = prefs["provider"]
    if provider == "auto":
        provider = key_provider or "openai"
    return provider, prefs["model"]
