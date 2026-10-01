"""Practice coaching derived purely from the parsed score.

No AI provider, no API key, no network. Everything here is deterministic from
MusicXML analysis so Lune stays free for the operator and the musician.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from backend.analyzer import MeasureInfo, NoteInfo, ScoreAnalysis

# Plain-English labels for difficulty reasons (shown to students).
FOCUS_LABELS = {
    "wide leaps": "Big jumps between notes — look ahead before you leap.",
    "busy texture": "Lots of notes close together — keep the hand quiet and close to the keys.",
    "multiple voices": "More than one line at once — decide which voice sings loudest.",
    "awkward fingering spots": "The hand shape is tricky — trust the finger numbers.",
    "dynamic change": "The volume changes here — plan the soft or loud before you arrive.",
}


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
    if measure.dynamics and reasons:
        reasons.append("dynamic change")

    return {
        "measure": measure.number,
        "score": round(total, 2),
        "reasons": reasons or ["straightforward"],
        "noteCount": len(notes),
        "isHard": bool(reasons) and reasons != ["straightforward"] and total >= 1.2,
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

    fallback = [item for item in ranked if item["reasons"] != ["straightforward"]]
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
            "title": "Name the notes",
            "minutes": 3,
            "detail": "Say the letter names out loud, one hand at a time.",
            "bars": focus[:1],
        },
        {
            "title": "Own the hard bits",
            "minutes": 5,
            "detail": "Loop only the tricky chunk slowly with the finger numbers written in.",
            "bars": focus[:1],
        },
        {
            "title": "Join the neighbours",
            "minutes": 4,
            "detail": "Play the bar before + this bar + the bar after at half speed.",
            "bars": focus,
        },
        {
            "title": "Add the markings",
            "minutes": 3,
            "detail": "One slow pass just for soft/loud and accents.",
            "bars": focus,
        },
    ]

    return {
        "focusBars": focus,
        "totalMinutes": sum(step["minutes"] for step in steps),
        "steps": steps,
    }


def _pack_note(n: NoteInfo) -> Dict[str, Any]:
    return {
        "pitch": n.pitch,
        "letter": f"{n.letter}{n.octave}",
        "midi": n.midi,
        "voice": n.voice,
        "fingering": n.fingering,
        "fingeringNote": n.fingering_note or "",
        "duration": float(getattr(n, "quarter_length", None) or 0.5),
        "offset": float(n.offset),
        "black": n.is_black_key,
        "hand": n.hand,
    }


def _focus_points(measure: MeasureInfo, difficulty: Dict[str, Any]) -> List[str]:
    """Short, plain things to focus on in this bar."""
    points: List[str] = []
    for reason in difficulty["reasons"]:
        if reason == "straightforward":
            continue
        points.append(FOCUS_LABELS.get(reason, reason.capitalize() + "."))

    rh = [n for n in measure.notes if n.hand == "RH"]
    lh = [n for n in measure.notes if n.hand == "LH"]
    if rh and lh and not any("hand" in p.lower() for p in points):
        points.append("Both hands are busy — practise each hand alone first.")

    if measure.dynamics:
        dyn = ", ".join(d.text for d in measure.dynamics)
        points.append(f"Dynamics marked: {dyn}.")

    if not points:
        points.append("Keep a steady pulse and listen for a clear top note.")
    return points[:5]


def _line_advice(measure: MeasureInfo, difficulty: Dict[str, Any]) -> Dict[str, List[str]]:
    """Specialised tips per hand / melodic line in this bar."""
    rh = sorted([n for n in measure.notes if n.hand == "RH"], key=lambda n: (n.offset, -n.midi))
    lh = sorted([n for n in measure.notes if n.hand == "LH"], key=lambda n: (n.offset, -n.midi))
    advice: Dict[str, List[str]] = {"rh": [], "lh": [], "together": []}

    def hand_tips(notes: List[NoteInfo], label: str) -> List[str]:
        tips: List[str] = []
        if not notes:
            return tips
        letters = " → ".join(f"{n.letter}{n.octave}" for n in notes[:10])
        tips.append(f"Line: {letters}" + ("…" if len(notes) > 10 else ""))
        span = max(n.midi for n in notes) - min(n.midi for n in notes)
        if span >= 12:
            tips.append(f"{label}: wide stretch — keep the wrist soft and shift the arm, don’t poke.")
        if sum(1 for n in notes if n.is_black_key) >= max(2, len(notes) // 3):
            tips.append(f"{label}: many black keys — stay high on the keys and keep fingertips firm.")
        if any(n.is_chord_member for n in notes):
            tips.append(f"{label}: in chords, voice the top note a little louder than the rest.")
        leaps = 0
        ordered = sorted(notes, key=lambda n: (n.offset, n.midi))
        for a, b in zip(ordered, ordered[1:]):
            if abs(b.midi - a.midi) >= 7 and abs(b.offset - a.offset) > 1e-6:
                leaps += 1
        if leaps:
            tips.append(f"{label}: prepare leaps by looking at the landing note before you leave.")
        fingers = [n.fingering for n in notes if n.fingering]
        if fingers:
            tips.append(
                f"{label} fingers: {'–'.join(str(f) for f in fingers[:12])}"
                + ("…" if len(fingers) > 12 else "")
            )
        if len(notes) >= 8:
            tips.append(f"{label}: dense bar — practise in groups of 3–4 notes, then glue the joins.")
        if not tips[1:]:
            tips.append(f"{label}: sing this line once out loud, then match that shape on the keys.")
        return tips

    advice["rh"] = hand_tips(rh, "Right hand")
    advice["lh"] = hand_tips(lh, "Left hand")
    if rh and lh:
        advice["together"] = [
            "Hands together only after each hand’s line is clean alone.",
            "Listen for which hand carries the tune — that hand leads, the other supports.",
        ]
        if difficulty.get("isHard"):
            advice["together"].append(
                "Slow metronome: one hand alone → both hands at half speed → nudge the tempo up."
            )
    return advice


def _melodic_runs(notes: List[NoteInfo]) -> List[List[NoteInfo]]:
    """Group same-hand notes into runs (one note sounding at a time, moving forward)."""
    ordered = sorted(notes, key=lambda n: (n.offset, -n.midi))
    if not ordered:
        return []

    runs: List[List[NoteInfo]] = []
    current: List[NoteInfo] = [ordered[0]]
    for note in ordered[1:]:
        prev = current[-1]
        same_hand = note.hand == prev.hand
        moving = abs(note.offset - prev.offset) > 1e-6
        not_huge_gap = abs(note.offset - prev.offset) <= max(
            float(getattr(prev, "quarter_length", None) or 0.5), 0.5
        ) * 1.5
        if same_hand and moving and not_huge_gap and not note.is_chord_member:
            current.append(note)
        else:
            if len(current) >= 4:
                runs.append(current)
            current = [note]
    if len(current) >= 4:
        runs.append(current)
    return runs


def _chunk_run(run: List[NoteInfo], size: int = 4) -> List[Dict[str, Any]]:
    chunks: List[Dict[str, Any]] = []
    for start in range(0, len(run), size):
        part = run[start : start + size]
        if len(part) < 2:
            continue
        labels = []
        for n in part:
            finger = f"({n.fingering})" if n.fingering else ""
            labels.append(f"{n.letter}{n.octave}{finger}")
        fingers = [n.fingering for n in part if n.fingering]
        count = len(part)
        chunks.append(
            {
                "notes": labels,
                "fingers": fingers,
                "hand": part[0].hand,
                "how": (
                    f"Play these {count} notes alone: "
                    + " → ".join(labels)
                    + (
                        f". Fingers: {'–'.join(str(f) for f in fingers)}."
                        if fingers
                        else "."
                    )
                ),
            }
        )
    return chunks


def _split_practice(measure: MeasureInfo, difficulty: Dict[str, Any]) -> Dict[str, Any]:
    """For hard bars / runs: how to break them up and which fingers to use."""
    is_hard = difficulty.get("isHard") or (
        difficulty["reasons"] != ["straightforward"] and difficulty["score"] >= 1.0
    )
    runs = _melodic_runs(measure.notes)
    chunks: List[Dict[str, Any]] = []
    for run in runs:
        chunks.extend(_chunk_run(run, size=4 if len(run) >= 8 else 3))

    # If busy but no long run, split by hand into small groups by time.
    if is_hard and not chunks:
        for hand in ("RH", "LH"):
            hand_notes = sorted(
                [n for n in measure.notes if n.hand == hand],
                key=lambda n: (n.offset, -n.midi),
            )
            if len(hand_notes) >= 5:
                chunks.extend(_chunk_run(hand_notes, size=3))

    practice_notes: List[str] = []
    if is_hard or chunks:
        practice_notes.append(
            "Slow practice: one chunk clean, then add the next. Never rush the join."
        )
        if chunks:
            practice_notes.append(
                "Say the finger numbers out loud while you play each chunk."
            )
        if "wide leaps" in difficulty["reasons"]:
            practice_notes.append(
                "For jumps: freeze on the landing note, then go back and add the leap."
            )
        if "busy texture" in difficulty["reasons"] or chunks:
            practice_notes.append(
                "Use a dotted rhythm on the run (long–short, then short–long) to lock the fingers in."
            )
        practice_notes.append(
            "Only put hands together when each hand’s chunks feel easy alone."
        )

    return {
        "needed": bool(chunks) or is_hard,
        "chunks": chunks[:8],
        "practiceNotes": practice_notes,
    }


def measure_debrief(analysis: ScoreAnalysis, number: int) -> Dict[str, Any]:
    """Everything useful about one clicked bar — plain language for students."""
    measure = next((m for m in analysis.measures if m.number == number), None)
    if not measure:
        return {"measure": number, "found": False}

    difficulty = score_measure(measure)
    rh = [n for n in measure.notes if n.hand == "RH"]
    lh = [n for n in measure.notes if n.hand == "LH"]

    how_to_play: List[str] = []
    if difficulty["reasons"] != ["straightforward"]:
        how_to_play.append("Watch for: " + ", ".join(difficulty["reasons"]) + ".")
    if any(n.is_chord_member for n in measure.notes):
        how_to_play.append(
            "Build chords from the bottom note up; keep the top note singing."
        )
    if rh and lh:
        how_to_play.append("Hands together only after each hand is clean alone.")
    if measure.dynamics:
        how_to_play.append(
            "Dynamics here: " + ", ".join(d.text for d in measure.dynamics) + "."
        )
    if any(n.fingering for n in measure.notes):
        how_to_play.append(
            "Use the suggested finger numbers until the shape feels automatic."
        )

    split = _split_practice(measure, difficulty)
    fingerings = {
        "rh": [
            {"letter": f"{n.letter}{n.octave}", "finger": n.fingering, "why": n.fingering_note or ""}
            for n in sorted(rh, key=lambda n: (n.offset, -n.midi))
            if n.fingering
        ],
        "lh": [
            {"letter": f"{n.letter}{n.octave}", "finger": n.fingering, "why": n.fingering_note or ""}
            for n in sorted(lh, key=lambda n: (n.offset, -n.midi))
            if n.fingering
        ],
    }
    lines = _line_advice(measure, difficulty)

    return {
        "measure": number,
        "found": True,
        "difficulty": difficulty,
        "focus": _focus_points(measure, difficulty),
        "lineAdvice": lines,
        "rh": [_pack_note(n) for n in sorted(rh, key=lambda n: (n.offset, -n.midi))],
        "lh": [_pack_note(n) for n in sorted(lh, key=lambda n: (n.offset, -n.midi))],
        "dynamics": [d.text for d in measure.dynamics],
        "harmony": [h.roman or h.chord for h in measure.harmony if h.roman or h.chord],
        "expressions": measure.expressions,
        "howToPlay": how_to_play,
        "fingerings": fingerings,
        "split": split,
        "playback": [_pack_note(n) for n in sorted(measure.notes, key=lambda n: (n.offset, -n.midi))],
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
