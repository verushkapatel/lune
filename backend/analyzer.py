"""Parse MusicXML into structured, musically correct score data.

All ordering and interval logic uses MIDI pitch numbers so that enharmonics and
letter names never distort pitch comparisons.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import music21

BLACK_PITCH_CLASSES = {1, 3, 6, 8, 10}
HARMONY_MEASURE_LIMIT = 400


@dataclass
class NoteInfo:
    pitch: str
    letter: str
    octave: int
    midi: int
    duration: str
    quarter_length: float
    voice: int
    staff: str
    hand: str
    offset: float
    beat: Optional[float]
    measure: int
    fingering: int | None = None
    fingering_note: str = ""
    is_chord_member: bool = False
    is_black_key: bool = False
    is_grace: bool = False
    tie: str = ""
    slurred: bool = False
    articulations: List[str] = field(default_factory=list)


@dataclass
class DynamicMark:
    text: str
    measure: int
    offset: float
    kind: str = "dynamic"


@dataclass
class HarmonyInfo:
    measure: int
    offset: float
    chord: str
    roman: str = ""


@dataclass
class MeasureInfo:
    number: int
    notes: List[NoteInfo] = field(default_factory=list)
    dynamics: List[DynamicMark] = field(default_factory=list)
    harmony: List[HarmonyInfo] = field(default_factory=list)
    tempo: str = ""
    key_signature: str = ""
    time_signature: str = ""
    expressions: List[str] = field(default_factory=list)


@dataclass
class ScoreAnalysis:
    title: str
    composer: Optional[str]
    notated_key: str
    analyzed_key: str
    key_confidence: str
    time_signature: str
    tempo: str
    measures: List[MeasureInfo]
    parts: List[str]
    has_pickup: bool = False
    clefs: List[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return self.notated_key or self.analyzed_key


def _duration_label(duration: music21.duration.Duration) -> str:
    try:
        if duration.isGrace:
            return "grace"
        label = duration.type or "unknown"
        if duration.dots:
            label = f"dotted {label}" if duration.dots == 1 else f"{duration.dots}x-dotted {label}"
        return label
    except Exception:
        return "unknown"


def _hand_from_clef(clef_obj: Optional[music21.clef.Clef], fallback: str) -> str:
    if clef_obj is None:
        return fallback
    if isinstance(clef_obj, music21.clef.BassClef):
        return "LH"
    if isinstance(clef_obj, music21.clef.TrebleClef):
        return "RH"
    return fallback


def _assign_voices(notes: List[NoteInfo]) -> None:
    """Voice 1 is the top line; higher numbers descend toward the bass."""
    if not notes:
        return
    if len(notes) == 1:
        notes[0].voice = 1
        return

    for index, note in enumerate(sorted(notes, key=lambda n: -n.midi), start=1):
        note.voice = index
        note.is_chord_member = True


def _articulation_names(note_el: music21.note.Note) -> List[str]:
    names = []
    for art in getattr(note_el, "articulations", []) or []:
        name = getattr(art, "name", "") or art.__class__.__name__.lower()
        names.append(name)
    for expr in getattr(note_el, "expressions", []) or []:
        name = getattr(expr, "name", "") or expr.__class__.__name__.lower()
        names.append(name)
    return names


def _is_slurred(note_el: music21.note.Note) -> bool:
    try:
        return any(
            isinstance(site, music21.spanner.Slur) for site in note_el.getSpannerSites()
        )
    except Exception:
        return False


def _safe_beat(note_el: music21.note.Note) -> Optional[float]:
    try:
        return round(float(note_el.beat), 3)
    except Exception:
        return None


def _build_note(
    note_el: music21.note.Note,
    offset: float,
    measure_number: int,
    staff_label: str,
    hand: str,
) -> NoteInfo:
    pitch = note_el.pitch
    tie_type = ""
    if note_el.tie is not None:
        tie_type = note_el.tie.type or ""

    return NoteInfo(
        pitch=pitch.nameWithOctave,
        letter=pitch.step,
        octave=pitch.octave if pitch.octave is not None else 4,
        midi=int(pitch.midi),
        duration=_duration_label(note_el.duration),
        quarter_length=float(note_el.duration.quarterLength),
        voice=1,
        staff=staff_label,
        hand=hand,
        offset=offset,
        beat=_safe_beat(note_el),
        measure=measure_number,
        is_black_key=int(pitch.midi) % 12 in BLACK_PITCH_CLASSES,
        is_grace=bool(note_el.duration.isGrace),
        tie=tie_type,
        slurred=_is_slurred(note_el),
        articulations=_articulation_names(note_el),
    )


def _extract_notes(
    measure: music21.stream.Measure,
    measure_number: int,
    part_name: str,
    hand: str,
) -> List[NoteInfo]:
    groups: Dict[float, List[NoteInfo]] = {}

    for element in measure.recurse().notes:
        if isinstance(element, music21.chord.Chord):
            members = list(element.notes)
            base_offset = float(element.getOffsetInHierarchy(measure))
        elif isinstance(element, music21.note.Note):
            members = [element]
            try:
                base_offset = float(element.getOffsetInHierarchy(measure))
            except Exception:
                base_offset = float(element.offset)
        else:
            continue

        for member in members:
            info = _build_note(member, round(base_offset, 4), measure_number, part_name, hand)
            groups.setdefault(info.offset, []).append(info)

    notes: List[NoteInfo] = []
    for offset in sorted(groups):
        simultaneous = groups[offset]
        _assign_voices(simultaneous)
        notes.extend(sorted(simultaneous, key=lambda n: -n.midi))

    return notes


def _extract_dynamics(measure: music21.stream.Measure, measure_number: int) -> List[DynamicMark]:
    marks: List[DynamicMark] = []
    seen = set()

    def add(text: str, offset: float, kind: str) -> None:
        text = (text or "").strip()
        if not text:
            return
        token = f"{text.lower()}:{round(offset, 2)}"
        if token in seen:
            return
        seen.add(token)
        marks.append(DynamicMark(text=text, measure=measure_number, offset=offset, kind=kind))

    for element in measure.recurse():
        if isinstance(element, music21.dynamics.Dynamic):
            add(element.value or element.content or "", float(element.offset), "dynamic")
        elif isinstance(element, music21.dynamics.DynamicWedge):
            name = element.__class__.__name__.lower()
            label = "crescendo" if "cresc" in name else "diminuendo"
            add(label, float(element.offset), "wedge")

    return marks


def _extract_expressions(measure: music21.stream.Measure) -> List[str]:
    found = []
    for element in measure.recurse().getElementsByClass(music21.expressions.TextExpression):
        content = (element.content or "").strip()
        if content:
            found.append(content)
    return found


def _extract_tempo(measure: music21.stream.Measure) -> str:
    for element in measure.recurse().getElementsByClass(music21.tempo.TempoIndication):
        if isinstance(element, music21.tempo.MetronomeMark):
            parts = []
            if element.text:
                parts.append(str(element.text))
            if element.number:
                parts.append(f"{int(element.number)} bpm")
            if parts:
                return " — ".join(parts)
        text = getattr(element, "text", None)
        if text:
            return str(text)
    return ""


def _notated_key(score: music21.stream.Score) -> str:
    """Read the written key signature rather than inferring it."""
    try:
        signature = score.recurse().getElementsByClass(music21.key.KeySignature).first()
    except Exception:
        signature = None

    if signature is None:
        return ""

    if isinstance(signature, music21.key.Key):
        return f"{signature.tonic.name} {signature.mode}"

    try:
        as_key = signature.asKey("major")
        sharps = signature.sharps
        relative = as_key.relative
        accidental = "sharp" if sharps > 0 else "flat" if sharps < 0 else ""
        count = abs(sharps)
        detail = f"{count} {accidental}{'s' if count != 1 else ''}" if count else "no accidentals"
        return f"{as_key.tonic.name} major or {relative.tonic.name} minor ({detail})"
    except Exception:
        return ""


def _analyzed_key(score: music21.stream.Score) -> tuple:
    try:
        result = score.analyze("key")
        name = f"{result.tonic.name} {result.mode}"
        correlation = getattr(result, "correlationCoefficient", None)
        if correlation is None:
            confidence = "unrated"
        elif correlation > 0.85:
            confidence = "high"
        elif correlation > 0.7:
            confidence = "moderate"
        else:
            confidence = "low"
        return name, confidence
    except Exception:
        return "", "unavailable"


def _extract_harmony(score: music21.stream.Score, key_obj) -> Dict[int, List[HarmonyInfo]]:
    harmony: Dict[int, List[HarmonyInfo]] = {}
    try:
        chordified = score.chordify(removeRedundantPitches=True)
    except Exception:
        return harmony

    for measure in chordified.getElementsByClass(music21.stream.Measure):
        number = int(measure.number)
        entries: List[HarmonyInfo] = []

        for chord_el in measure.recurse().getElementsByClass(music21.chord.Chord):
            # A roman numeral needs a real chord. Single notes and dyads are
            # harmonically ambiguous, and labelling them invents information.
            if len({p.pitchClass for p in chord_el.pitches}) < 3:
                continue

            label = chord_el.pitchedCommonName
            roman_figure = ""
            if key_obj is not None:
                try:
                    roman_figure = music21.roman.romanNumeralFromChord(
                        chord_el, key_obj
                    ).figure
                except Exception:
                    roman_figure = ""
            entries.append(
                HarmonyInfo(
                    measure=number,
                    offset=round(float(chord_el.offset), 4),
                    chord=label,
                    roman=roman_figure,
                )
            )

        deduped: List[HarmonyInfo] = []
        for entry in entries:
            if deduped and deduped[-1].chord == entry.chord and deduped[-1].roman == entry.roman:
                continue
            deduped.append(entry)

        if deduped:
            harmony[number] = deduped

    return harmony


def analyze_score(path: str) -> ScoreAnalysis:
    score = music21.converter.parse(path)

    metadata = score.metadata
    title = (metadata.title if metadata and metadata.title else "") or "Untitled"
    composer = metadata.composer if metadata else None

    notated = _notated_key(score)
    analyzed, confidence = _analyzed_key(score)

    key_obj = None
    try:
        key_obj = score.analyze("key")
    except Exception:
        key_obj = None

    time_signature = "4/4"
    first_ts = score.recurse().getElementsByClass(music21.meter.TimeSignature).first()
    if first_ts:
        time_signature = first_ts.ratioString

    parts = [part.partName or f"Part {index + 1}" for index, part in enumerate(score.parts)]
    clefs: List[str] = []
    measure_map: Dict[int, MeasureInfo] = {}
    score_tempo = ""
    has_pickup = False

    for part_index, part in enumerate(score.parts):
        part_name = parts[part_index]
        fallback_hand = "RH" if part_index == 0 else "LH"

        current_clef = part.recurse().getElementsByClass(music21.clef.Clef).first()
        if current_clef is not None:
            clefs.append(f"{part_name}: {current_clef.__class__.__name__.replace('Clef', '')}")

        part_measures = list(part.getElementsByClass(music21.stream.Measure))

        for measure_index, measure in enumerate(part_measures):
            number = int(measure.number)

            local_clef = measure.getElementsByClass(music21.clef.Clef).first()
            if local_clef is not None:
                current_clef = local_clef
            hand = _hand_from_clef(current_clef, fallback_hand)

            if measure_index == 0 and first_ts is not None:
                try:
                    if measure.duration.quarterLength < first_ts.barDuration.quarterLength:
                        has_pickup = True
                except Exception:
                    pass

            info = measure_map.setdefault(number, MeasureInfo(number=number))
            info.notes.extend(_extract_notes(measure, number, part_name, hand))
            info.dynamics.extend(_extract_dynamics(measure, number))
            info.expressions.extend(_extract_expressions(measure))

            measure_tempo = _extract_tempo(measure)
            if measure_tempo and not info.tempo:
                info.tempo = measure_tempo
            if measure_tempo and not score_tempo:
                score_tempo = measure_tempo

            if not info.time_signature:
                local_ts = measure.getElementsByClass(music21.meter.TimeSignature).first()
                if local_ts:
                    info.time_signature = local_ts.ratioString

            if not info.key_signature:
                local_ks = measure.getElementsByClass(music21.key.KeySignature).first()
                if local_ks is not None:
                    sharps = getattr(local_ks, "sharps", 0)
                    info.key_signature = f"{sharps:+d}" if sharps else "0"

    measures = [measure_map[number] for number in sorted(measure_map)]

    if len(measures) <= HARMONY_MEASURE_LIMIT:
        harmony_map = _extract_harmony(score, key_obj)
        for measure in measures:
            measure.harmony = harmony_map.get(measure.number, [])

    for measure in measures:
        measure.notes.sort(key=lambda n: (n.hand != "RH", n.offset, -n.midi))

    return ScoreAnalysis(
        title=title,
        composer=composer,
        notated_key=notated,
        analyzed_key=analyzed,
        key_confidence=confidence,
        time_signature=time_signature,
        tempo=score_tempo,
        measures=measures,
        parts=parts,
        has_pickup=has_pickup,
        clefs=clefs,
    )


def analysis_to_dict(analysis: ScoreAnalysis) -> Dict[str, Any]:
    return {
        "title": analysis.title,
        "composer": analysis.composer,
        "notatedKey": analysis.notated_key,
        "analyzedKey": analysis.analyzed_key,
        "keyConfidence": analysis.key_confidence,
        "timeSignature": analysis.time_signature,
        "tempo": analysis.tempo,
        "parts": analysis.parts,
        "clefs": analysis.clefs,
        "hasPickup": analysis.has_pickup,
        "measures": [
            {
                "number": m.number,
                "tempo": m.tempo,
                "keySignature": m.key_signature,
                "timeSignature": m.time_signature,
                "expressions": m.expressions,
                "dynamics": [
                    {"text": d.text, "offset": d.offset, "kind": d.kind} for d in m.dynamics
                ],
                "harmony": [
                    {"chord": h.chord, "roman": h.roman, "offset": h.offset} for h in m.harmony
                ],
                "notes": [
                    {
                        "pitch": n.pitch,
                        "letter": n.letter,
                        "octave": n.octave,
                        "midi": n.midi,
                        "duration": n.duration,
                        "voice": n.voice,
                        "hand": n.hand,
                        "offset": n.offset,
                        "beat": n.beat,
                        "fingering": n.fingering,
                        "fingeringNote": n.fingering_note,
                        "isChordMember": n.is_chord_member,
                        "isBlackKey": n.is_black_key,
                        "articulations": n.articulations,
                        "slurred": n.slurred,
                        "tie": n.tie,
                    }
                    for n in m.notes
                ],
            }
            for m in analysis.measures
        ],
    }
