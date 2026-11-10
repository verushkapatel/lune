"""Piano fingering suggestions.

Uses a cost-minimising search over finger assignments rather than local rules of
thumb. Spans between finger pairs are modelled after the relaxed/practical ranges
used in the piano-fingering literature (Parncutt et al.), mirrored for the left
hand. All intervals are measured in semitones from MIDI numbers.
"""

from __future__ import annotations

import threading
from itertools import combinations
from typing import Dict, List, Optional, Tuple

from backend.analyzer import MeasureInfo, NoteInfo, ScoreAnalysis
from backend.preferences import HAND_SPAN_SCALE

# Adjacent finger pairs: (relaxed_min, relaxed_max, practical_min, practical_max)
# measured as semitones from the lower-numbered finger to the higher-numbered one,
# in the direction the hand naturally opens (rightwards for RH).
ADJACENT_SPANS: Dict[Tuple[int, int], Tuple[int, int, int, int]] = {
    (1, 2): (1, 5, -4, 10),
    (2, 3): (1, 3, -2, 5),
    (3, 4): (1, 3, -2, 5),
    (4, 5): (1, 3, -2, 5),
}

RUN_BREAK_BEATS = 2.0
# Any rest of an eighth or longer lets the hand reposition: the next note
# starts a new run instead of being fingered as part of the previous line.
REST_BREAK_QL = 0.5
LEAP_BREAK_SEMITONES = 16

# Cost of passing the thumb under a given finger, or crossing that finger back
# over the thumb. Crossing under 3 is the standard move; under 5 is not a thing.
THUMB_PASS_COST = {2: 3.0, 3: 1.0, 4: 1.6, 5: 6.0}

_SPAN_CACHE: Dict[Tuple[int, int, float], Tuple[int, int, int, int]] = {}

# Hand size is per-user, and solving runs on a worker thread per request, so the
# active scale is kept thread-local rather than passed through every cost function.
_state = threading.local()


def _span_scale() -> float:
    return getattr(_state, "span_scale", 1.0)


def _span(low_finger: int, high_finger: int) -> Tuple[int, int, int, int]:
    """Cumulative span limits between two fingers, low_finger < high_finger."""
    scale = _span_scale()
    key = (low_finger, high_finger, scale)
    if key in _SPAN_CACHE:
        return _SPAN_CACHE[key]

    relaxed_min = relaxed_max = practical_min = practical_max = 0
    for finger in range(low_finger, high_finger):
        r_min, r_max, p_min, p_max = ADJACENT_SPANS[(finger, finger + 1)]
        relaxed_min += r_min
        relaxed_max += r_max
        practical_min += p_min
        practical_max += p_max

    # Only the outward limits move with hand size; the closed position does not.
    result = (
        relaxed_min,
        max(relaxed_min, int(round(relaxed_max * scale))),
        practical_min,
        max(practical_min, int(round(practical_max * scale))),
    )
    _SPAN_CACHE[key] = result
    return result


def _oriented_interval(previous: NoteInfo, current: NoteInfo, hand: str) -> int:
    """Semitones in the direction the hand opens: rightwards RH, leftwards LH."""
    delta = current.midi - previous.midi
    return delta if hand == "RH" else -delta


def _span_cost(finger_a: int, finger_b: int, interval: int) -> Tuple[float, str]:
    """Cost of moving from finger_a to finger_b across an oriented interval."""
    if interval == 0:
        # A repeated note: reusing the finger is the default, and swapping to a
        # different one is a deliberate substitution.
        return (0.0, "repeat") if finger_a == finger_b else (2.5, "substitution")

    if finger_a == finger_b:
        # Same finger on a new note means the hand relocates. Across a leap that
        # is an ordinary position change; across a step it is a finger slide,
        # which no one does in a connected line.
        distance = abs(interval)
        if distance <= 2:
            return 9.0, "slide"
        if distance <= 5:
            return 5.0, "shift"
        return 3.0, "shift"

    crossing = finger_b < finger_a
    low, high = (finger_b, finger_a) if crossing else (finger_a, finger_b)
    relaxed_min, relaxed_max, practical_min, practical_max = _span(low, high)

    if crossing:
        expected_relaxed = (-relaxed_max, -relaxed_min)
        expected_practical = (-practical_max, -practical_min)
    else:
        expected_relaxed = (relaxed_min, relaxed_max)
        expected_practical = (practical_min, practical_max)

    if expected_relaxed[0] <= interval <= expected_relaxed[1]:
        return 0.0, "comfortable"

    if interval < expected_practical[0]:
        return 6.0 * (expected_practical[0] - interval) + 2.0, "cramped"
    if interval > expected_practical[1]:
        return 6.0 * (interval - expected_practical[1]) + 2.0, "overstretched"

    if interval < expected_relaxed[0]:
        return 2.0 * (expected_relaxed[0] - interval), "tight"
    return 2.0 * (interval - expected_relaxed[1]), "stretched"


def _note_cost(note: NoteInfo, finger: int) -> float:
    cost = 0.0
    if note.is_black_key:
        if finger == 1:
            cost += 4.5
        elif finger == 5:
            cost += 1.5
    if finger in (4, 5) and note.quarter_length >= 2.0:
        cost += 0.8
    if finger == 4 and note.articulations:
        cost += 0.4
    return cost


def _transition_cost(
    previous: NoteInfo,
    current: NoteInfo,
    finger_a: int,
    finger_b: int,
    hand: str,
) -> Tuple[float, str]:
    interval = _oriented_interval(previous, current, hand)

    if interval == 0:
        return _span_cost(finger_a, finger_b, interval)

    moving_outward = interval > 0

    # Thumb passing is how the hand travels along the keyboard. The thumb goes
    # under when moving outward and a longer finger crosses over it when moving
    # back, so these are cheap even though the finger number moves "backwards".
    thumb_under = moving_outward and finger_b == 1 and finger_a > 1
    cross_over_thumb = not moving_outward and finger_a == 1 and finger_b > 1

    if thumb_under or cross_over_thumb:
        long_finger = finger_a if thumb_under else finger_b
        reach = abs(interval)
        cost = THUMB_PASS_COST.get(long_finger, 4.0)
        if reach > 5:
            cost += 1.5 * (reach - 5)
        return cost, "crossing"

    cost, quality = _span_cost(finger_a, finger_b, interval)
    crossing = finger_b < finger_a

    if crossing and moving_outward:
        cost += 5.0
        quality = "crossing"
    elif not crossing and not moving_outward:
        cost += 4.5
        quality = "crossing"

    if previous.slurred and current.slurred and finger_a == finger_b:
        cost += 5.0

    return cost, quality


def _solve_run(notes: List[NoteInfo], hand: str) -> None:
    """Dynamic programming over finger choices for a melodic run."""
    if not notes:
        return

    fingers = (1, 2, 3, 4, 5)
    best: Dict[int, float] = {f: _note_cost(notes[0], f) for f in fingers}
    back: List[Dict[int, int]] = []
    quality: List[Dict[int, str]] = []

    for index in range(1, len(notes)):
        previous, current = notes[index - 1], notes[index]
        next_best: Dict[int, float] = {}
        next_back: Dict[int, int] = {}
        next_quality: Dict[int, str] = {}

        for finger_b in fingers:
            base = _note_cost(current, finger_b)
            best_total: Optional[float] = None
            best_prev = 1
            best_quality = "comfortable"

            for finger_a in fingers:
                move_cost, move_quality = _transition_cost(
                    previous, current, finger_a, finger_b, hand
                )
                total = best[finger_a] + move_cost + base
                if best_total is None or total < best_total:
                    best_total = total
                    best_prev = finger_a
                    best_quality = move_quality

            next_best[finger_b] = best_total if best_total is not None else base
            next_back[finger_b] = best_prev
            next_quality[finger_b] = best_quality

        best = next_best
        back.append(next_back)
        quality.append(next_quality)

    final_finger = min(best, key=lambda f: best[f])
    assignment = [final_finger]
    qualities = []

    for step in range(len(back) - 1, -1, -1):
        current_finger = assignment[0]
        qualities.insert(0, quality[step][current_finger])
        assignment.insert(0, back[step][current_finger])

    for index, note in enumerate(notes):
        note.fingering = assignment[index]
        note.fingering_note = _rationale(
            note,
            assignment[index],
            qualities[index - 1] if index > 0 else "",
            notes[index - 1] if index > 0 else None,
            hand,
        )


def _rationale(
    note: NoteInfo,
    finger: int,
    quality: str,
    previous: Optional[NoteInfo],
    hand: str,
) -> str:
    if quality == "crossing" and previous is not None:
        if finger == 1:
            return "thumb under"
        if previous.fingering == 1:
            return f"{finger} over the thumb"
        return f"cross to {finger}"
    if quality in ("shift", "slide"):
        return "position shift"
    if quality == "substitution":
        return "finger substitution on the repeated note"
    if quality == "repeat":
        return ""
    if quality in ("stretched", "overstretched"):
        return "stretch — keep the wrist loose"
    if quality in ("tight", "cramped"):
        return "tight — contract the hand"
    if note.is_black_key and finger != 1:
        return "keeps the thumb off the black key"
    return ""


def _solve_chord(notes: List[NoteInfo], hand: str) -> None:
    """Choose a finger set for simultaneous notes by best span fit."""
    ordered = sorted(notes, key=lambda n: n.midi)
    count = len(ordered)

    if count == 1:
        _solve_run(ordered, hand)
        return

    if count > 5:
        ordered = ordered[:5]
        count = 5

    best_choice: Optional[Tuple[int, ...]] = None
    best_cost: Optional[float] = None

    for candidate in combinations((1, 2, 3, 4, 5), count):
        # RH numbers rise with pitch; LH numbers fall with pitch.
        assignment = candidate if hand == "RH" else tuple(reversed(candidate))
        cost = 0.0

        for index, note in enumerate(ordered):
            cost += _note_cost(note, assignment[index])

        # The hand anchors on the thumb at the inner end of the chord, and a wide
        # chord should reach out to the fifth finger rather than bunching up.
        anchor = assignment[0] if hand == "RH" else assignment[-1]
        outer = assignment[-1] if hand == "RH" else assignment[0]
        if anchor != 1:
            cost += 0.6
        if ordered[-1].midi - ordered[0].midi >= 7 and outer != 5:
            cost += 0.8

        # Break ties toward the more open, stable hand shape.
        cost -= 0.01 * (max(assignment) - min(assignment))

        for index in range(1, count):
            lower, upper = ordered[index - 1], ordered[index]
            finger_low, finger_high = assignment[index - 1], assignment[index]
            oriented = upper.midi - lower.midi
            low = min(finger_low, finger_high)
            high = max(finger_low, finger_high)
            relaxed_min, relaxed_max, practical_min, practical_max = _span(low, high)

            # Prefer the finger pair whose natural opening best matches the
            # interval, so a fourth takes 1-3 rather than a pinched 1-2.
            centre = (relaxed_min + relaxed_max) / 2.0
            cost += 0.3 * abs(oriented - centre)

            if relaxed_min <= oriented <= relaxed_max:
                continue
            if oriented > practical_max:
                cost += 6.0 * (oriented - practical_max) + 2.0
            elif oriented < practical_min:
                cost += 6.0 * (practical_min - oriented) + 2.0
            elif oriented > relaxed_max:
                cost += 2.0 * (oriented - relaxed_max)
            else:
                cost += 2.0 * (relaxed_min - oriented)

        if best_cost is None or cost < best_cost:
            best_cost = cost
            best_choice = assignment

    if best_choice is None:
        return

    total_span = ordered[-1].midi - ordered[0].midi
    for index, note in enumerate(ordered):
        note.fingering = best_choice[index]
        if total_span >= 12 and index in (0, len(ordered) - 1):
            note.fingering_note = "octave or wider — open from the wrist"
        elif note.is_black_key and note.fingering != 1:
            note.fingering_note = "keeps the thumb off the black key"
        else:
            note.fingering_note = ""


_BAR_STARTS: Dict[int, float] = {}


def _set_bar_starts(analysis: ScoreAnalysis, beats_per_measure: float) -> None:
    """Real start of every bar in quarter notes; a pickup is only as long as its notes."""
    _BAR_STARTS.clear()
    position = 0.0
    measures = sorted(analysis.measures, key=lambda m: m.number)
    for index, measure in enumerate(measures):
        _BAR_STARTS[measure.number] = position
        content = max((n.offset + n.quarter_length for n in measure.notes), default=beats_per_measure)
        length = beats_per_measure
        if index == 0 and 0 < content < beats_per_measure - 1e-6:
            length = content
        position += length


def _global_position(note: NoteInfo, beats_per_measure: float) -> float:
    start = _BAR_STARTS.get(note.measure)
    if start is None:
        return (note.measure - 1) * beats_per_measure + note.offset
    return start + note.offset


def _beats_per_measure(time_signature: str) -> float:
    try:
        numerator, denominator = time_signature.split("/")
        return float(numerator) * (4.0 / float(denominator))
    except Exception:
        return 4.0


def suggest_fingering(analysis: ScoreAnalysis, hand_span: str = "medium") -> ScoreAnalysis:
    _state.span_scale = HAND_SPAN_SCALE.get(hand_span, 1.0)
    beats = _beats_per_measure(analysis.time_signature)
    _set_bar_starts(analysis, beats)

    for hand in ("RH", "LH"):
        hand_notes = [
            note
            for measure in analysis.measures
            for note in measure.notes
            if note.hand == hand
        ]
        if not hand_notes:
            continue

        hand_notes.sort(key=lambda n: (n.measure, n.offset, n.midi))

        # Group simultaneous notes, then split into runs at rests and big leaps.
        events: List[List[NoteInfo]] = []
        for note in hand_notes:
            position = _global_position(note, beats)
            if events and abs(_global_position(events[-1][0], beats) - position) < 0.001:
                events[-1].append(note)
            else:
                events.append([note])

        run: List[NoteInfo] = []
        for index, event in enumerate(events):
            if len(event) > 1:
                if run:
                    _solve_run(run, hand)
                    run = []
                _solve_chord(event, hand)
                continue

            note = event[0]
            if run:
                previous = run[-1]
                gap = _global_position(note, beats) - (
                    _global_position(previous, beats) + previous.quarter_length
                )
                leap = abs(note.midi - previous.midi)
                repositions = gap >= REST_BREAK_QL or (gap >= 0.25 and leap >= 5)
                if repositions or gap > RUN_BREAK_BEATS or leap > LEAP_BREAK_SEMITONES:
                    _solve_run(run, hand)
                    run = []
            run.append(note)

        if run:
            _solve_run(run, hand)

    return analysis


def fingering_summary(measure: MeasureInfo, hand: str) -> str:
    notes = [n for n in measure.notes if n.hand == hand and n.fingering]
    if not notes:
        return ""
    return " ".join(str(n.fingering) for n in notes)
