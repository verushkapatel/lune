"""Practice coaching derived purely from the parsed score.

No AI provider, no API key, no network. Everything here is deterministic from
MusicXML analysis so Lune stays free for the operator and the musician.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.analyzer import MeasureInfo, NoteInfo, ScoreAnalysis


def _leap_score(notes: List[NoteInfo]) -> float:
    ordered = sorted(notes, key=lambda n: (n.offset, n.midi))
    if len(ordered) < 2:
        return 0.0
    total = 0.0
    for previous, current in zip(ordered, ordered[1:]):
        if previous.hand != current.hand:
            continue
        gap = abs(current.midi - previous.midi)
        if gap >= 7:
            total += (gap - 6) * 0.35
    return total


def _density_score(notes: List[NoteInfo]) -> float:
    if not notes:
        return 0.0
    chords = sum(1 for n in notes if n.is_chord_member)
    black = sum(1 for n in notes if n.is_black_key)
    return len(notes) * 0.15 + chords * 0.25 + black * 0.2


def _polyphony_score(notes: List[NoteInfo]) -> float:
    voices = {n.voice for n in notes}
    hands = {n.hand for n in notes}
    score = 0.0
    if len(voices) >= 3:
        score += 1.2
    elif len(voices) == 2:
        score += 0.5
    if len(hands) == 2:
        score += 0.4
    return score


def _awkward_fingering_score(notes: List[NoteInfo]) -> float:
    score = 0.0
    for note in notes:
        if note.fingering == 1 and note.is_black_key:
            score += 0.8
        if note.fingering_note:
            score += 0.3
    return score


def score_measure(measure: MeasureInfo) -> Dict[str, Any]:
    notes = measure.notes
    leap = _leap_score(notes)
    density = _density_score(notes)
    polyphony = _polyphony_score(notes)
    awkward = _awkward_fingering_score(notes)
    total = leap + density + polyphony + awkward

    reasons: List[str] = []
    if leap >= 1.0:
        reasons.append("wide leaps")
    if density >= 1.5:
        reasons.append("busy texture")
    if polyphony >= 1.0:
        reasons.append("multiple voices")
    if awkward >= 0.8:
        reasons.append("awkward fingering spots")
    # Dynamics alone don't make a bar "hard" — only mention them alongside real difficulty.
    if measure.dynamics and reasons:
        reasons.append("dynamic change")

    return {
        "measure": measure.number,
        "score": round(total, 2),
        "reasons": reasons or ["straightforward"],
        "noteCount": len(notes),
    }


def hard_spots(analysis: ScoreAnalysis, limit: int = 5) -> List[Dict[str, Any]]:
    ranked = [score_measure(m) for m in analysis.measures if m.notes]
    ranked.sort(key=lambda item: item["score"], reverse=True)
    if not ranked:
        return []

    meaningful = [
        item
        for item in ranked
        if item["score"] >= 1.2 and item["reasons"] != ["straightforward"]
    ]
    if meaningful:
        return meaningful[:limit]

    # Quiet pieces: surface the busiest bars that at least have a non-trivial reason.
    fallback = [
        item
        for item in ranked
        if item["reasons"] != ["straightforward"]
    ]
    return (fallback or ranked[:1])[: min(2, limit)]



def letter_rows(analysis: ScoreAnalysis) -> List[Dict[str, Any]]:
    rows = []
    for measure in analysis.measures:
        by_hand: Dict[str, List[str]] = {"RH": [], "LH": []}
        for note in sorted(measure.notes, key=lambda n: (n.hand != "RH", n.offset, -n.midi)):
            token = note.letter + str(note.octave)
            if note.fingering:
                token = f"{token}({note.fingering})"
            by_hand.setdefault(note.hand, []).append(token)
        rows.append(
            {
                "measure": measure.number,
                "rh": by_hand.get("RH", []),
                "lh": by_hand.get("LH", []),
                "dynamics": [d.text for d in measure.dynamics],
                "harmony": [
                    h.roman or h.chord for h in measure.harmony if h.roman or h.chord
                ],
            }
        )
    return rows


def practice_plan(analysis: ScoreAnalysis, focus_bars: Optional[List[int]] = None) -> Dict[str, Any]:
    spots = hard_spots(analysis)
    focus = focus_bars or [s["measure"] for s in spots[:3]] or [1]

    steps = [
        {
            "title": "Map the notes",
            "minutes": 3,
            "detail": f"Letter-name the selected bars aloud, hands separate.",
            "bars": focus[:1],
        },
        {
            "title": "Own the spot",
            "minutes": 5,
            "detail": f"Loop the clicked bars slowly until fingering is automatic.",
            "bars": focus[:1],
        },
        {
            "title": "Connect",
            "minutes": 4,
            "detail": "Join the bars before and after at half speed.",
            "bars": focus,
        },
        {
            "title": "Markings",
            "minutes": 3,
            "detail": "One pass for dynamics and articulation only.",
            "bars": focus,
        },
    ]

    return {
        "focusBars": focus,
        "totalMinutes": sum(step["minutes"] for step in steps),
        "steps": steps,
    }


def measure_debrief(analysis: ScoreAnalysis, number: int) -> Dict[str, Any]:
    """Everything useful about one clicked bar — no filler."""
    measure = next((m for m in analysis.measures if m.number == number), None)
    if not measure:
        return {"measure": number, "found": False}

    difficulty = score_measure(measure)
    rh = [n for n in measure.notes if n.hand == "RH"]
    lh = [n for n in measure.notes if n.hand == "LH"]

    def pack(notes: List[NoteInfo]) -> List[Dict[str, Any]]:
        return [
            {
                "pitch": n.pitch,
                "letter": f"{n.letter}{n.octave}",
                "midi": n.midi,
                "voice": n.voice,
                "fingering": n.fingering,
                "duration": n.duration,
                "black": n.is_black_key,
            }
            for n in sorted(notes, key=lambda n: (n.offset, -n.midi))
        ]

    how_to_play: List[str] = []
    if difficulty["reasons"] != ["straightforward"]:
        how_to_play.append("Watch for: " + ", ".join(difficulty["reasons"]) + ".")
    if any(n.is_chord_member for n in measure.notes):
        how_to_play.append("Shape the chord from the bottom note up; keep the top voice singing.")
    if rh and lh:
        how_to_play.append("Hands together only after each hand is clean alone.")
    if measure.dynamics:
        how_to_play.append(
            "Dynamics here: " + ", ".join(d.text for d in measure.dynamics) + "."
        )
    fingers = [n.fingering for n in measure.notes if n.fingering]
    if fingers:
        how_to_play.append("Stay with the printed fingering numbers until the shape feels automatic.")

    return {
        "measure": number,
        "found": True,
        "difficulty": difficulty,
        "rh": pack(rh),
        "lh": pack(lh),
        "dynamics": [d.text for d in measure.dynamics],
        "harmony": [h.roman or h.chord for h in measure.harmony if h.roman or h.chord],
        "expressions": measure.expressions,
        "howToPlay": how_to_play,
    }


def coach_payload(analysis: ScoreAnalysis) -> Dict[str, Any]:
    return {
        "hardSpots": hard_spots(analysis),
        "letters": letter_rows(analysis),
        "measures": [
            {
                "number": m.number,
                "noteCount": len(m.notes),
                "hasChord": any(n.is_chord_member for n in m.notes),
                "hands": sorted({n.hand for n in m.notes}),
            }
            for m in analysis.measures
        ],
    }

