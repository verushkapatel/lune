"""Practice coaching derived purely from the parsed score.

No AI provider, no API key, no network. Everything here is deterministic from
MusicXML analysis so Lune stays free for the operator and the musician.

The advice engine reads concrete musical facts out of each bar — leaps,
chord spans, chromatic/scale runs, dotted rhythms, syncopation, grace notes,
fingering landmines — and maps them to standard, publicly-known piano
pedagogy (silent jump practice, 1-3-1-3 chromatic fingering, rolling wide
chords, subdividing dotted rhythms, hands-separate work).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from backend.analyzer import MeasureInfo, NoteInfo, ScoreAnalysis

# Plain-English labels for difficulty reasons (shown to students).
FOCUS_LABELS = {
    "wide leaps": "Big jumps between notes — look ahead before you leap.",
    "busy texture": "Lots of notes close together — keep the hand quiet and close to the keys.",
    "multiple voices": "More than one line at once — decide which voice sings loudest.",
    "awkward fingering spots": "The hand shape is tricky — trust the finger numbers.",
    "dynamic change": "The volume changes here — plan the soft or loud before you arrive.",
}

# Short on-score labels for challenge tags (headline chips, line summaries).
TAG_LABELS = {
    "leap": "wide leap",
    "wide-chord": "wide chord",
    "chord": "chord voicing",
    "chromatic": "chromatic run",
    "scale-run": "scale run",
    "dotted": "dotted rhythm",
    "syncopation": "syncopation",
    "dense": "busy bar",
    "grace": "grace notes",
    "thumb-black": "thumb on black key",
    "black-keys": "black-key terrain",
    "hands-together": "both hands busy",
    "repeat-figure": "repeated figure",
    "dynamics": "dynamic shape",
    "tempo": "tempo change",
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
            token = _note_letter(note)
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


def _note_letter(n: NoteInfo) -> str:
    """Sight-reading label with accidental + octave (G#3, Bb4)."""
    pitch = (n.pitch or "").replace("-", "b")
    if pitch:
        return pitch
    return f"{n.letter}{n.octave}"


def _pack_note(n: NoteInfo) -> Dict[str, Any]:
    return {
        "pitch": (n.pitch or "").replace("-", "b"),
        "letter": _note_letter(n),
        "midi": n.midi,
        "voice": n.voice,
        "fingering": n.fingering,
        "fingeringNote": n.fingering_note or "",
        "duration": float(getattr(n, "quarter_length", None) or 0.5),
        "offset": float(n.offset),
        "black": n.is_black_key,
        "hand": n.hand,
    }


_INTERVAL_NAMES = {
    1: "semitone",
    2: "whole step",
    3: "minor 3rd",
    4: "major 3rd",
    5: "4th",
    6: "tritone",
    7: "5th",
    8: "minor 6th",
    9: "major 6th",
    10: "minor 7th",
    11: "major 7th",
    12: "octave",
    13: "minor 9th",
    14: "9th",
    15: "minor 10th",
    16: "10th",
}


def _interval_name(semitones: int) -> str:
    s = abs(int(semitones))
    if s in _INTERVAL_NAMES:
        return _INTERVAL_NAMES[s]
    if s == 24:
        return "two octaves"
    if 17 <= s <= 28:
        inner = _INTERVAL_NAMES.get(s - 12)
        if inner:
            return f"octave plus a {inner}"
    return f"stretch of {s} semitones"


def _an_interval(semitones: int) -> str:
    """Interval name with its article: 'an octave', 'a 10th'."""
    name = _interval_name(semitones)
    article = "an" if name[0].lower() in "aeio8" else "a"
    return f"{article} {name}"


def _hand_name(hand: str) -> str:
    return "Right hand" if hand == "RH" else "Left hand"


def _onset_groups(notes: List[NoteInfo]) -> List[List[NoteInfo]]:
    """Notes grouped by onset time (chords together), graces excluded."""
    by_offset: Dict[float, List[NoteInfo]] = {}
    for n in notes:
        if n.is_grace:
            continue
        by_offset.setdefault(round(n.offset, 4), []).append(n)
    return [by_offset[k] for k in sorted(by_offset)]


def _outline(groups: List[List[NoteInfo]], hand: str) -> List[NoteInfo]:
    """The moving line a hand actually travels: top voice for RH, bass for LH."""
    if hand == "LH":
        return [min(g, key=lambda n: n.midi) for g in groups]
    return [max(g, key=lambda n: n.midi) for g in groups]


def _meter(measure: MeasureInfo, fallback_ts: str = "") -> Tuple[float, float]:
    """(beat count, beat length in quarter-lengths) for the bar's meter."""
    ts = measure.time_signature or fallback_ts or "4/4"
    try:
        num, den = ts.split("/")
        beat_len = 4.0 / float(den)
        return float(num), beat_len
    except Exception:
        return 4.0, 1.0


def _hand_advice(measure: MeasureInfo, hand: str) -> List[Tuple[float, str, str]]:
    """Specific, pedagogy-backed tips for one hand in one bar.

    Returns (priority, tag, text) tuples; higher priority surfaces first.
    """
    notes = [n for n in measure.notes if n.hand == hand]
    if not notes:
        return []
    tips: List[Tuple[float, str, str]] = []
    label = _hand_name(hand)
    groups = _onset_groups(notes)
    line = _outline(groups, hand)

    # --- Leaps: the hand has to travel. Classic fix: silent jump practice. ---
    best_leap = None
    for a, b in zip(line, line[1:]):
        gap = abs(b.midi - a.midi)
        if gap >= 9 and (best_leap is None or gap > best_leap[0]):
            best_leap = (gap, a, b)
    if best_leap:
        gap, a, b = best_leap
        direction = "up" if b.midi > a.midi else "down"
        tips.append((
            4.0 + gap / 6.0,
            "leap",
            f"{label} leaps {direction} {_an_interval(gap)} — "
            f"{_note_letter(a)} to {_note_letter(b)}. Practise the jump silently first: "
            f"eyes find {_note_letter(b)} before the hand leaves {_note_letter(a)}, "
            "then add sound once the distance feels automatic.",
        ))

    # --- Chord spans: roll what you cannot reach; voice the top. ---
    widest = None
    for g in groups:
        if len(g) < 2:
            continue
        span = max(n.midi for n in g) - min(n.midi for n in g)
        if span >= 7 and (widest is None or span > widest[0]):
            widest = (span, g)
    if widest:
        span, g = widest
        ordered = sorted(g, key=lambda n: n.midi)
        lo, hi = ordered[0], ordered[-1]
        names = "+".join(_note_letter(n) for n in ordered)
        if span >= 14:
            tips.append((
                4.2,
                "wide-chord",
                f"{label} chord {names} spans {_an_interval(span)} — if the reach "
                f"is too wide, roll it gently from {_note_letter(lo)} up, landing "
                f"{_note_letter(hi)} exactly on the beat.",
            ))
        else:
            tips.append((
                2.0,
                "chord",
                f"{label} chord {names} — shape the hand in the air before landing, "
                f"and let the top note {_note_letter(hi)} sing above the others.",
            ))

    # --- Chromatic runs: 1-3-1-3 standard fingering. ---
    chrom = 0
    best_chrom = 0
    chrom_start = 0
    for i, (a, b) in enumerate(zip(line, line[1:])):
        if abs(b.midi - a.midi) == 1:
            chrom += 1
            if chrom > best_chrom:
                best_chrom = chrom
                chrom_start = i - chrom + 1
        else:
            chrom = 0
    if best_chrom >= 3:
        seg = line[chrom_start : chrom_start + best_chrom + 1]
        tips.append((
            3.6,
            "chromatic",
            f"Chromatic run {_note_letter(seg[0])} to {_note_letter(seg[-1])} in the "
            f"{label.lower()} — use the standard chromatic fingering 1-3-1-3: thumb on "
            "white keys, finger 3 on black keys, hand gliding close to the fallboard.",
        ))
    else:
        # --- Scale runs: smooth thumb-under, practise in groups. ---
        run = 0
        best_run = 0
        run_start = 0
        direction = 0
        for i, (a, b) in enumerate(zip(line, line[1:])):
            step = b.midi - a.midi
            same_dir = (step > 0 and direction >= 0) or (step < 0 and direction <= 0)
            if 1 <= abs(step) <= 2 and same_dir:
                run += 1
                direction = 1 if step > 0 else -1
                if run > best_run:
                    best_run = run
                    run_start = i - run + 1
            else:
                run = 0
                direction = 0
        if best_run >= 5:
            seg = line[run_start : run_start + best_run + 1]
            tips.append((
                3.0,
                "scale-run",
                f"Scale run {_note_letter(seg[0])} to {_note_letter(seg[-1])} in the "
                f"{label.lower()} — keep the thumb-under crossing silent and level, and "
                "practise it in groups of four with a small pause between groups.",
            ))

    # --- Thumb forced onto a black key: adjust hand position. ---
    for n in notes:
        if n.fingering == 1 and n.is_black_key:
            tips.append((
                2.6,
                "thumb-black",
                f"Finger 1 lands on {_note_letter(n)}, a black key — move the whole "
                "hand slightly into the keys so the thumb reaches it without twisting.",
            ))
            break

    # --- Repeated figure: spot it, loop it once, reuse it. ---
    iv = [b.midi - a.midi for a, b in zip(line, line[1:])]
    if len(iv) >= 6 and len(iv) % 2 == 0:
        half = len(iv) // 2
        if iv[:half] == iv[half:]:
            tips.append((
                1.6,
                "repeat-figure",
                f"The {label.lower()} repeats the same figure twice in this bar — "
                "perfect the first statement slowly and the repeat comes free.",
            ))

    return tips


def bar_advice(
    measure: MeasureInfo, fallback_ts: str = ""
) -> Tuple[List[str], List[str], str]:
    """Concrete practice advice for one bar.

    Returns (advice_texts, tags, headline). Every sentence references actual
    notes, intervals, rhythms or fingers found in the bar.
    """
    tips: List[Tuple[float, str, str]] = []
    tips.extend(_hand_advice(measure, "RH"))
    tips.extend(_hand_advice(measure, "LH"))

    pitched = [n for n in measure.notes if not n.is_grace]
    onsets = sorted({round(n.offset, 4) for n in pitched})
    beats, beat_len = _meter(measure, fallback_ts)

    # --- Dotted rhythms: subdivide and count. ---
    dotted = [n for n in pitched if "dotted" in (n.duration or "")]
    if dotted:
        names = ", ".join(dict.fromkeys(_note_letter(n) for n in dotted[:4]))
        tips.append((
            2.8,
            "dotted",
            f"Dotted rhythm on {names} — subdivide and count the small beats aloud "
            "(\u201c1-and-a, 2-and-a\u201d) so the short note arrives exactly late, never lazy.",
        ))

    # --- Syncopation: more off-beat than on-beat attacks (meter-aware). ---
    def _is_off_beat(t: float) -> bool:
        pos = t / beat_len
        return abs(pos - round(pos)) > 0.2

    if len(onsets) >= 4:
        off_beats = [t for t in onsets if _is_off_beat(t)]
        if len(off_beats) > len(onsets) / 2:
            off_notes = [n for n in pitched if _is_off_beat(n.offset)]
            names = ", ".join(dict.fromkeys(_note_letter(n) for n in off_notes[:4]))
            tips.append((
                2.9,
                "syncopation",
                f"Syncopation — {names} land between the beats. Tap a steady pulse "
                "with one hand and say the rhythm out loud before playing it.",
            ))

    # --- Density: many attacks per beat. ---
    if beats > 0 and len(onsets) / beats >= 2.5 and len(pitched) >= 8:
        tips.append((
            2.4,
            "dense",
            f"{len(pitched)} notes across {len(onsets)} attacks in one bar — practise "
            "in chunks of three or four notes, stop on the first note of each chunk, "
            "then glue the joins at half speed.",
        ))

    # --- Grace notes: before the beat, lightly. ---
    graces = [n for n in measure.notes if n.is_grace]
    if graces:
        names = ", ".join(dict.fromkeys(_note_letter(n) for n in graces[:3]))
        tips.append((
            2.2,
            "grace",
            f"Grace note on {names} — flick it lightly just before the beat; the main "
            "note keeps the pulse, the ornament never steals time.",
        ))

    # --- Black-key terrain. ---
    blacks = [n for n in pitched if n.is_black_key]
    if pitched and len(blacks) >= max(3, len(pitched) // 2):
        names = ", ".join(dict.fromkeys(_note_letter(n) for n in blacks[:4]))
        tips.append((
            1.8,
            "black-keys",
            f"Mostly black keys here ({names}) — play nearer the fallboard where the "
            "black keys sit, with firm curved fingertips.",
        ))

    # --- Both hands busy: hands separate first. ---
    rh_onsets = {round(n.offset, 4) for n in pitched if n.hand == "RH"}
    lh_onsets = {round(n.offset, 4) for n in pitched if n.hand == "LH"}
    if len(rh_onsets) >= 3 and len(lh_onsets) >= 3:
        tips.append((
            1.5,
            "hands-together",
            f"Both hands are active ({len(rh_onsets)} right-hand and {len(lh_onsets)} "
            "left-hand attacks) — practise hands separately until each is easy, then "
            "join at half speed before returning to tempo.",
        ))

    # --- Markings. ---
    if measure.dynamics:
        dyn = ", ".join(dict.fromkeys(d.text for d in measure.dynamics))
        tips.append((
            1.2,
            "dynamics",
            f"Marked {dyn} — decide the sound before the bar begins and let the arm "
            "weight, not finger force, make the change.",
        ))
    if measure.tempo:
        tips.append((
            1.1,
            "tempo",
            f"Tempo marking here: {measure.tempo} — set the new pulse by counting one "
            "silent bar before you continue.",
        ))

    # Order, dedupe by tag, cap.
    tips.sort(key=lambda t: -t[0])
    seen = set()
    texts: List[str] = []
    tags: List[str] = []
    for _, tag, text in tips:
        if tag in seen:
            continue
        seen.add(tag)
        texts.append(text)
        tags.append(tag)
        if len(texts) >= 5:
            break

    headline = " · ".join(TAG_LABELS.get(t, t) for t in tags[:2])
    return texts, tags, headline


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
        letters = " → ".join(_note_letter(n) for n in notes[:10])
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
            labels.append(f"{_note_letter(n)}{finger}")
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

    advice, tags, headline = bar_advice(measure, analysis.time_signature)

    # Keep howToPlay for UI compatibility, but fill it with the specific advice.
    how_to_play: List[str] = list(advice)
    if not how_to_play and (rh or lh):
        letters = [
            _note_letter(n)
            for n in sorted(measure.notes, key=lambda n: (n.offset, -n.midi))[:6]
        ]
        how_to_play.append(
            f"A calm bar — {', '.join(letters)}. Keep a steady pulse and use it to "
            "look ahead to the next bar."
        )

    split = _split_practice(measure, difficulty)
    fingerings = {
        "rh": [
            {"letter": _note_letter(n), "finger": n.fingering, "why": n.fingering_note or ""}
            for n in sorted(rh, key=lambda n: (n.offset, -n.midi))
            if n.fingering
        ],
        "lh": [
            {"letter": _note_letter(n), "finger": n.fingering, "why": n.fingering_note or ""}
            for n in sorted(lh, key=lambda n: (n.offset, -n.midi))
            if n.fingering
        ],
    }
    lines = _line_advice(measure, difficulty)

    return {
        "measure": number,
        "found": True,
        "difficulty": difficulty,
        "advice": advice,
        "tags": tags,
        "headline": headline,
        "focus": advice or _focus_points(measure, difficulty),
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
