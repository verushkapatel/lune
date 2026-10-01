"""Turn a parsed score into compact, unambiguous context for the model."""

from __future__ import annotations

import re
from typing import List, Optional

from backend.analyzer import MeasureInfo, ScoreAnalysis

VOICE_NAMES = {1: "top", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th"}

LEGEND = (
    "Notation used below: each note is written pitch/voice/duration/finger, where voice 1 is the "
    "highest sounding line in that hand and f3 means third finger (1 = thumb). Markers in "
    "brackets are articulations, ties, slurs, or fingering notes. Bar numbers are the numbers "
    "printed in the file."
)


def _note_token(note) -> str:
    parts = [note.pitch, f"v{note.voice}", note.duration]
    if note.fingering:
        parts.append(f"f{note.fingering}")

    token = "/".join(parts)

    markers: List[str] = []
    markers.extend(note.articulations)
    if note.slurred:
        markers.append("slur")
    if note.tie:
        markers.append(f"tie-{note.tie}")
    if note.fingering_note:
        markers.append(note.fingering_note)

    if markers:
        token += " [" + ", ".join(markers) + "]"
    return token


def _measure_block(measure: MeasureInfo, detailed: bool) -> List[str]:
    header_bits = [f"m.{measure.number}"]
    if measure.time_signature:
        header_bits.append(measure.time_signature)
    if measure.tempo:
        header_bits.append(f"tempo {measure.tempo}")
    if measure.dynamics:
        header_bits.append("dyn " + ", ".join(d.text for d in measure.dynamics))
    if measure.expressions:
        header_bits.append("text " + "; ".join(measure.expressions))

    lines = [" | ".join(header_bits)]

    if measure.harmony:
        chords = []
        for entry in measure.harmony:
            label = entry.roman or entry.chord
            if entry.roman and entry.chord:
                label = f"{entry.roman} ({entry.chord})"
            chords.append(label)
        lines.append("  harmony: " + " > ".join(chords))

    if not detailed:
        return lines

    if not measure.notes:
        lines.append("  (no notes — rest or empty bar)")
        return lines

    for hand in ("RH", "LH"):
        hand_notes = [n for n in measure.notes if n.hand == hand]
        if not hand_notes:
            continue
        lines.append(f"  {hand}: " + "   ".join(_note_token(n) for n in hand_notes))

    return lines


def _range_summary(analysis: ScoreAnalysis, hand: str) -> str:
    notes = [n for m in analysis.measures for n in m.notes if n.hand == hand]
    if not notes:
        return ""
    lowest = min(notes, key=lambda n: n.midi)
    highest = max(notes, key=lambda n: n.midi)
    return f"{hand} range {lowest.pitch}–{highest.pitch} ({len(notes)} notes)"


def build_score_digest(
    analysis: ScoreAnalysis,
    max_measures: Optional[int] = None,
) -> str:
    total = len(analysis.measures)
    detail_limit = max_measures or total

    lines = [
        f"Title: {analysis.title}",
        f"Composer: {analysis.composer or 'not stated in the file'}",
    ]

    if analysis.notated_key:
        lines.append(f"Written key signature: {analysis.notated_key}")
    else:
        lines.append("Written key signature: none found in the file")

    if analysis.analyzed_key:
        lines.append(
            f"Algorithmically estimated key: {analysis.analyzed_key} "
            f"(confidence {analysis.key_confidence} — this is a statistical guess, not the "
            "notated key; treat it as a hint and prefer the written key signature)"
        )

    lines.append(f"Time signature: {analysis.time_signature}")
    if analysis.tempo:
        lines.append(f"Tempo marking: {analysis.tempo}")
    if analysis.has_pickup:
        lines.append("The piece begins with a pickup (incomplete first bar).")
    if analysis.clefs:
        lines.append("Clefs: " + "; ".join(analysis.clefs))

    lines.append(f"Parts/staves: {', '.join(analysis.parts) or 'one staff'}")
    lines.append(f"Total bars in file: {total}")

    ranges = [r for r in (_range_summary(analysis, "RH"), _range_summary(analysis, "LH")) if r]
    if ranges:
        lines.append("; ".join(ranges))

    lines.append("")
    lines.append(
        "Fingering below was computed by a span-cost solver, not taken from an edition. "
        "It is a sensible starting point for average hands; adapt it freely and say so if the "
        "user's level or hand size calls for something different."
    )
    lines.append("")
    lines.append(LEGEND)
    lines.append("")

    detailed_measures = analysis.measures[:detail_limit]
    outline_measures = analysis.measures[detail_limit:]

    for measure in detailed_measures:
        lines.extend(_measure_block(measure, detailed=True))

    if outline_measures:
        first = outline_measures[0].number
        last = outline_measures[-1].number
        lines.append("")
        lines.append(
            f"Full note detail above covers bars {detailed_measures[0].number}–"
            f"{detailed_measures[-1].number} only. Bars {first}–{last} are summarised below "
            "without individual notes. If the user asks about those bars, say that you have "
            "the structure but not the note-level data for them, and offer to look at a "
            "smaller excerpt."
        )
        lines.append("")
        for measure in outline_measures:
            lines.extend(_measure_block(measure, detailed=False))

    return "\n".join(lines)


def extract_measure_from_question(question: str) -> Optional[int]:
    patterns = [
        r"measures?\s+(\d+)",
        r"bars?\s+(\d+)",
        r"\bmm?\.\s*(\d+)",
        r"#(\d+)",
    ]
    lowered = question.lower()
    for pattern in patterns:
        match = re.search(pattern, lowered)
        if match:
            return int(match.group(1))
    return None
