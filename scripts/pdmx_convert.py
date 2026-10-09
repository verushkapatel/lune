#!/usr/bin/env python3
"""Turn one PDMX MusicRender JSON (a solo piano score) into MusicXML (.mxl).

PDMX (Long et al., 2024) is MuseScore's public-domain and CC0 scores, read
into a JSON format. Its .mxl copies sit on Zenodo; the JSON is what can be
fetched from here, so Lune writes the MusicXML itself, from the score's own
data and nothing else:

- every note: its pitch, spelled as the file spells it (A-flat stays A-flat),
  its onset and its length; grace notes too
- bars from the file's own barlines, so pickups and changes of metre land
  where they were written; key and time signatures; tempo marks
- repeats: the JSON writes repeats out in full, so the score is rebuilt from
  each bar's first appearance, with repeat signs (and first and second
  endings) where the order of bars jumps back
- dynamics, staccato, accent, tenuto, marcato, fermata, trills, mordents,
  and turns, on the note that sounds at their time

What the JSON does not keep is which staff each note was on: a piano part is
one track. Lune divides the notes between the hands by following each hand's
register through the piece, so a hand never stretches past a tenth. The
pitches and rhythms are the file's; the split between staves is Lune's.

Usage: python3 scripts/pdmx_convert.py in.json out.mxl
"""
from __future__ import annotations

import json
import sys
from fractions import Fraction

from music21 import (articulations, bar, clef, dynamics, expressions, key, layout, meter, note,
                     spanner, stream, tempo, chord)

ARTIC = {
    "staccato": articulations.Staccato, "articStaccatoBelow": articulations.Staccato, "articStaccatoAbove": articulations.Staccato,
    "staccatissimo": articulations.Staccatissimo, "articStaccatissimoBelow": articulations.Staccatissimo, "articStaccatissimoAbove": articulations.Staccatissimo,
    "accent": articulations.Accent, "articAccentBelow": articulations.Accent, "articAccentAbove": articulations.Accent,
    "tenuto": articulations.Tenuto, "articTenutoBelow": articulations.Tenuto, "articTenutoAbove": articulations.Tenuto,
    "marcato": articulations.StrongAccent, "articMarcatoAbove": articulations.StrongAccent, "articMarcatoBelow": articulations.StrongAccent,
    "sforzato": articulations.Accent,
}
ORN = {
    "ornamentTrill": expressions.Trill, "trill": expressions.Trill,
    "ornamentMordent": expressions.Mordent, "mordent": expressions.Mordent,
    "ornamentMordentInverted": expressions.InvertedMordent, "prall": expressions.InvertedMordent, "ornamentShortTrill": expressions.InvertedMordent,
    "ornamentTurn": expressions.Turn, "turn": expressions.Turn,
    "ornamentTurnInverted": expressions.InvertedTurn,
}
DYN = {"pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sf", "sfz", "sffz", "fz", "rf", "rfz", "fp", "sfp"}


def spelled(midi: int, name: str):
    from music21 import pitch

    try:
        p = pitch.Pitch(name.replace("b", "-") if len(name) > 1 else name)
    except Exception:
        p = pitch.Pitch(midi=midi)
        return p
    base = p.ps % 12
    octave = (midi - base) // 12 - 1
    p.octave = int(octave)
    # B-sharp / C-flat cross the octave line
    while p.midi < midi:
        p.octave += 1
    while p.midi > midi:
        p.octave -= 1
    return p


def split_hands(groups):
    """groups: [(time, [notes])] in time order. Returns {id(note): 'rh'|'lh'}.

    Notes that start and end together are one chord, played by one hand when
    it spans a tenth or less; each chord goes to the hand whose recent register
    it fits, with middle C and above leaning to the right hand. Only a stack
    wider than a tenth is divided, at the split that keeps both hands closest
    to where they have been."""
    from itertools import product

    # where each hand starts: the piece's own register above and below middle C
    allp = [n["pitch"] for _, ns in groups for n in ns]
    hi = [p for p in allp if p >= 60]
    lo = [p for p in allp if p < 60]
    rh_c = sum(hi) / len(hi) if hi else 67.0
    lh_c = sum(lo) / len(lo) if lo else 50.0
    hand = {}
    for _, ns in groups:
        by_len = {}
        for n in ns:
            by_len.setdefault(n["duration"], []).append(n)
        units = []
        for chord_ in by_len.values():
            chord_ = sorted(chord_, key=lambda n: n["pitch"])
            if chord_[-1]["pitch"] - chord_[0]["pitch"] <= 16:
                units.append(chord_)
            else:
                # too wide for one hand: divide at the widest gap
                ps = [n["pitch"] for n in chord_]
                gap = max(range(1, len(ps)), key=lambda i: ps[i] - ps[i - 1])
                units += [chord_[:gap], chord_[gap:]]
        split = min(60.0, max(56.0, (rh_c + lh_c) / 2))
        best, pick = None, None
        for combo in product(("lh", "rh"), repeat=min(len(units), 6)):
            lh = [n["pitch"] for u, h in zip(units, combo) if h == "lh" for n in u]
            rh = [n["pitch"] for u, h in zip(units, combo) if h == "rh" for n in u]
            cost = 0.0
            for u, h in zip(units, combo):
                mean = sum(n["pitch"] for n in u) / len(u)
                cost += len(u) * abs(mean - (rh_c if h == "rh" else lh_c))
                if h == "lh" and mean >= split:
                    cost += 25 * len(u)
                if h == "rh" and mean < split - 4:
                    cost += 25 * len(u)
            reach = 14 if len(units) > 1 else 16  # a ninth when a melody sounds over chords
            if lh and max(lh) - min(lh) > reach:
                cost += 400
            if rh and max(rh) - min(rh) > reach:
                cost += 400
            if lh and rh and min(rh) < max(lh) - 2:
                cost += 60  # hands crossing
            if best is None or cost < best:
                best, pick = cost, combo
        for u, h in zip(units, pick):
            for n in u:
                hand[id(n)] = h
        for u in units[len(pick):]:  # more than six chords at once (rare)
            for n in u:
                hand[id(n)] = "rh" if n["pitch"] >= split else "lh"
        rh_n = [n["pitch"] for n in ns if hand[id(n)] == "rh"]
        lh_n = [n["pitch"] for n in ns if hand[id(n)] == "lh"]
        if rh_n:
            rh_c = 0.75 * rh_c + 0.25 * (sum(rh_n) / len(rh_n))
        if lh_n:
            lh_c = 0.75 * lh_c + 0.25 * (sum(lh_n) / len(lh_n))
        if rh_c < lh_c + 7:
            mid = (rh_c + lh_c) / 2
            rh_c, lh_c = mid + 3.5, mid - 3.5
    return hand


def undrift(notes, order, first, seq=None):
    """Put back lower-staff notes whose times drift early in some PDMX files.

    In those files a whole-bar rest in the lower staff is counted short, so
    every later lower-staff note runs early by a growing amount. Within a bar
    the spacing is right, and every note still names its bar. So, bar by bar:
    the amount is how far the earliest early note sits before the bar (its
    first left-hand note is on the downbeat); it stays the same from bar to
    bar and only grows after a bar where the lower staff rests. Notes that
    could be either hand are settled by register, only when that is
    clear-cut. Any bar that does not fit makes the whole file refused.
    Returns the notes with corrected times (unchanged when nothing drifts)."""
    by = {}
    for n in notes:
        by.setdefault(int(n.get("measure") or 0), []).append(n)
    if not any(n["time"] < first[m][0] for m, ns in by.items() if m in first for n in ns):
        return notes
    fixed = {}
    prev, prev_lh = None, False
    pos = {}
    for i, (mm, st, en) in enumerate(seq or []):
        if first.get(mm) == (st, en):
            pos[mm] = i
    last_i = None
    last_bar = None
    for m in order:
        s, e = first[m]
        # a repeat played in between (other bars in time order) can grow the drift too
        if last_i is not None and pos.get(m, last_i + 1) != last_i + 1:
            prev_lh = False
        last_i = pos.get(m, last_i)
        ns = [n for n in by.get(m, []) if n["time"] < e]
        early = [n for n in ns if n["time"] < s]
        inside = [n for n in ns if n["time"] >= s]
        if not early:
            # no early notes: either the lower staff rests, or (if a drift is
            # running) its notes might start late in the bar; refuse if any
            # note here could belong to the lower staff by register
            if prev and any(n["pitch"] < 55 and n["time"] + prev + n["duration"] <= e + 1 for n in inside):
                raise ValueError("drift: a lower-staff bar cannot be placed")
            prev_lh = False
            continue
        est = s - min(n["time"] for n in early)

        def fits(dl):
            return all(s <= n["time"] + dl and n["time"] + dl + n["duration"] <= e + 1 for n in early)

        def ends_on_bar(dl):
            return abs(max(n["time"] + dl + n["duration"] for n in early) - e) <= 1

        if prev is None or est == prev:
            delta = est
        elif est < prev and prev_lh and fits(prev):
            delta = prev  # the bar's first left-hand note comes after the downbeat
        elif est > prev and not prev_lh:
            delta = est  # a rest bar before made the drift grow
        elif fits(est) and ends_on_bar(est):
            # the drift changed inside a run: accepted only when the bar proves it,
            # its left hand starting on the downbeat and ending on the barline
            delta = est
        else:
            raise ValueError("drift: inconsistent")
        for n in early:
            t = n["time"] + delta
            if not (s <= t and t + n["duration"] <= e + 1):
                raise ValueError("drift: early note does not fit its bar")
            fixed[id(n)] = t
        lh_hi = max(n["pitch"] for n in early)
        sure_rh = [n for n in inside if n["time"] + delta + n["duration"] > e + 1]
        rh_lo = min([n["pitch"] for n in sure_rh] or [999])
        for n in inside:
            if n in sure_rh:
                continue
            if n["pitch"] <= lh_hi + 2 and n["pitch"] < rh_lo - 2:
                fixed[id(n)] = n["time"] + delta
            elif n["pitch"] > lh_hi + 2:
                pass  # right hand, where it is
            else:
                raise ValueError("drift: a note could be either hand")
        # time lost inside this bar (the drift grows straight after it, with no
        # resting bar between) means a rest inside it was dropped: unless the
        # left hand still ends on the barline, where it went cannot be known
        if prev is not None and prev_lh and delta > prev and last_bar is not None and not last_bar[2]:
            raise ValueError("drift: time lost inside a bar")
        last_bar = (m, delta, ends_on_bar(delta))
        prev, prev_lh = delta, True
    out = []
    for n in notes:
        if id(n) in fixed:
            n = dict(n, time=fixed[id(n)])
        out.append(n)
    return out



def convert(src: str, dst: str) -> dict:
    d = json.load(open(src))
    R = int(d.get("resolution") or 480)
    q = lambda ticks: Fraction(int(ticks), R)
    tracks = d.get("tracks") or []
    if not tracks:
        raise ValueError("no tracks")
    notes = [n for t in tracks for n in t.get("notes", [])]
    if not notes:
        raise ValueError("no notes")
    end_all = max(int(d.get("song_length") or 0), max(n["time"] + n["duration"] for n in notes))

    # bars in time order, with their printed numbers
    bl = sorted(d.get("barlines") or [], key=lambda b: b["time"])
    tsl = sorted(d.get("time_signatures") or [], key=lambda t: t["time"])
    last_ts = tsl[-1] if tsl else {"numerator": 4, "denominator": 4}
    bar_ticks = R * 4 * int(last_ts["numerator"]) // int(last_ts["denominator"])
    seq = []
    for i, b in enumerate(bl):
        # the last bar is as long as its time signature says (the file's own
        # total length can run a tick past it)
        nxt = bl[i + 1]["time"] if i + 1 < len(bl) else max(b["time"] + bar_ticks, max([n["time"] + 1 for n in notes if n["time"] >= b["time"]] or [0]))
        if nxt > b["time"]:
            seq.append((int(b["measure"]), int(b["time"]), int(nxt)))
    if not seq:
        raise ValueError("no bars")
    first = {}
    order = []
    for m, s, e in seq:
        if m not in first:
            first[m] = (s, e)
            order.append(m)

    notes = undrift(notes, order, first, seq)

    # repeats: where the bar order jumps back
    start_rep, end_rep, ending1, ending2 = set(), set(), [], []
    nums = [m for m, _, _ in seq]
    seen = set()
    i = 0
    while i < len(nums):
        m = nums[i]
        seen.add(m)
        if i + 1 < len(nums) and nums[i + 1] <= m:
            target = nums[i + 1]
            end_rep.add(m)
            if target != order[0]:
                start_rep.add(target)
            j = i + 1
            while j < len(nums) and nums[j] in seen:
                j += 1
            if j < len(nums):
                last_common = nums[j - 1]
                skipped = [x for x in order if last_common < x <= m]
                if skipped and nums[j] > m:
                    ending1.append(skipped)
                    ending2.append(nums[j])
                    end_rep.discard(m)
                    end_rep.add(skipped[-1])
            i = j
            continue
        i += 1

    # notes in each bar's first appearance
    # each note names its bar, and its time must fall inside an appearance of
    # that bar. Some PDMX files (often ones with a pickup) carry lower-staff
    # times that drift away from their bars; their timing cannot be recovered
    # with certainty, so such a file is refused rather than guessed at.
    spans = {}
    for m, st, en in seq:
        spans.setdefault(m, []).append((st, en))
    # (notes of a written-out repeat pass are not kept, so only the first pass is checked)
    for n in notes:
        m_ = int(n.get("measure") or 0)
        if m_ in first and n["time"] < first[m_][1] and not (first[m_][0] <= n["time"]):
            raise ValueError("note times drift from their bars")
        if not any(st <= n["time"] < en for st, en in spans.get(m_, [])) and n["time"] < first.get(m_, (0, 0))[1]:
            raise ValueError("note times drift from their bars")

    def place(t, m):
        span = first.get(m)
        return t if span and span[0] <= t < span[1] else None

    keep = []
    for n in notes:
        m = int(n.get("measure") or 0)
        t = place(n["time"], m)
        if t is None:
            continue
        n = dict(n, time=t, measure=m)
        keep.append(n)
    groups = {}
    for n in keep:
        groups.setdefault(n["time"], []).append(n)
    hand = split_hands(sorted(groups.items()))

    ann = list(d.get("annotations") or []) + [a for t in tracks for a in (t.get("annotations") or [])]

    score = stream.Score()
    parts = {}
    for h in ("rh", "lh"):
        p = stream.PartStaff()
        p.id = h
        parts[h] = p
    def fifths_ok(f):
        f = int(f or 0)
        # more than seven sharps or flats is written as its enharmonic key
        while f > 7:
            f -= 12
        while f < -7:
            f += 12
        return f

    ks = {int(k["measure"]): fifths_ok(k.get("fifths")) for k in d.get("key_signatures") or [] if k.get("measure") in first}
    ts = {int(t["measure"]): (int(t["numerator"]), int(t["denominator"])) for t in d.get("time_signatures") or [] if t.get("measure") in first}
    tempos = {}
    for t in d.get("tempos") or []:
        if t.get("measure") in first and int(t["measure"]) not in tempos:
            tempos[int(t["measure"])] = t
    prev_ts = None
    pickup = False
    measures = {"rh": [], "lh": []}
    for idx, m in enumerate(order):
        s, e = first[m]
        length = q(e - s)
        for h in ("rh", "lh"):
            meas = stream.Measure(number=idx + 1)
            if idx == 0:
                meas.insert(0, clef.TrebleClef() if h == "rh" else clef.BassClef())
            if m in ks or idx == 0:
                meas.insert(0, key.KeySignature(ks.get(m, ks.get(order[0], 0))))
            want = ts.get(m)
            if idx == 0 and not want:
                want = (4, 4)
            if want and want != prev_ts:
                meas.insert(0, meter.TimeSignature(f"{want[0]}/{want[1]}"))
            if h == "rh" and m in tempos:
                t = tempos[m]
                txt = str(t.get("text") or "").strip()
                bpm = round(float(t.get("qpm") or 0)) or None
                if "<sym>" in txt or not txt:
                    meas.insert(0, tempo.MetronomeMark(number=bpm))
                else:
                    mm_ = tempo.MetronomeMark(text=txt[:40], number=bpm)
                    mm_.numberImplicit = True
                    meas.insert(0, mm_)
            if m in start_rep:
                meas.leftBarline = bar.Repeat(direction="start")
            if m in end_rep:
                meas.rightBarline = bar.Repeat(direction="end")
            # this hand's notes, chorded where they overlap
            content = stream.Stream()
            graces = []
            for n in keep:
                if int(n["measure"]) != m or hand.get(id(n)) != h:
                    continue
                off = q(n["time"] - s)
                dur = min(q(n["duration"]), length - off)
                if n.get("is_grace"):
                    graces.append((off, n))
                    continue
                if dur <= 0:
                    continue
                x = note.Note(spelled(n["pitch"], n.get("pitch_str") or ""))
                x.quarterLength = dur
                content.insert(off, x)
            if content.notes:
                ch = content.chordify()
                for el in list(ch.flatten().notesAndRests):
                    if isinstance(el, note.Rest):
                        continue
                    at_ = el.getOffsetInHierarchy(ch)
                    if isinstance(el, chord.Chord) and len(el.pitches) == 1:
                        y = note.Note(el.pitches[0])
                        y.quarterLength = el.quarterLength
                        y.tie = el.tie
                        el = y
                    meas.insert(at_, el)
            for off, n in graces:
                g = note.Note(spelled(n["pitch"], n.get("pitch_str") or ""))
                g.quarterLength = Fraction(1, 2)
                g = g.getGrace()
                meas.insert(off, g)
            full = Fraction(4 * (want or prev_ts or (4, 4))[0], (want or prev_ts or (4, 4))[1])
            if idx == 0 and length < full:
                pickup = True
                meas.paddingLeft = full - length
            measures[h].append((m, meas, s, e))
            parts[h].append(meas)
        prev_ts = want or prev_ts

    # markings, on the note sounding at their time
    def find(m, t):
        for h in ("rh", "lh"):
            for mm, meas, s, e in measures[h]:
                if mm == m:
                    off = q(t - s)
                    for el in meas.notes:
                        if el.offset == off and not el.duration.isGrace:
                            return el, meas, off
        return None, None, None

    for a in ann:
        info = a.get("annotation") or {}
        name, sub = info.get("name"), str(info.get("subtype") or "")
        m = int(a.get("measure") or 0)
        t_ = place(int(a.get("time") or 0), m)
        if t_ is None:
            continue
        a = dict(a, time=t_)
        if name == "Dynamic" and sub in DYN:
            for mm, meas, ms, me in measures["rh"]:
                if mm == m:
                    meas.insert(q(int(a["time"]) - ms), dynamics.Dynamic(sub))
        elif name == "Articulation" and (sub in ARTIC or sub in ORN or sub == "fermata"):
            el, meas, off = find(m, int(a["time"]))
            if el is None:
                continue
            if sub in ARTIC:
                el.articulations.append(ARTIC[sub]())
            elif sub in ORN:
                el.expressions.append(ORN[sub]())
            else:
                el.expressions.append(expressions.Fermata())
        elif name == "Fermata":
            el, meas, off = find(m, int(a["time"]))
            if el is not None:
                el.expressions.append(expressions.Fermata())

    for one, two in zip(ending1, ending2):
        for h in ("rh", "lh"):
            ms = [meas for mm, meas, _, _ in measures[h] if mm in one]
            if ms:
                parts[h].insert(0, spanner.RepeatBracket(ms, number=1))
            ms2 = [meas for mm, meas, _, _ in measures[h] if mm == two]
            if ms2:
                parts[h].insert(0, spanner.RepeatBracket(ms2, number=2))

    for h in ("rh", "lh"):
        for _, meas, ms, me in measures[h]:
            # rests exactly in the gaps, up to the bar's true length
            span = q(me - ms)
            t = Fraction(0)
            for el in sorted([e for e in meas.notes if not e.duration.isGrace], key=lambda e: e.offset):
                o = Fraction(el.offset)
                if o > t:
                    r = note.Rest()
                    r.quarterLength = o - t
                    meas.insert(t, r)
                t = max(t, o + Fraction(el.quarterLength))
            if t < span:
                r = note.Rest()
                r.quarterLength = span - t
                meas.insert(t, r)
            # a length no single note value can show becomes tied parts
            for el in list(meas.notesAndRests):
                if el.duration.type in ("complex", "inexpressible") and el.quarterLength > 0:
                    off = el.offset
                    parts_ = el.splitAtDurations()
                    if len(parts_) > 1:
                        meas.remove(el)
                        t = off
                        for piece in parts_:
                            meas.insert(t, piece)
                            t += piece.quarterLength
        score.insert(0, parts[h])
    score.insert(0, layout.StaffGroup([parts["rh"], parts["lh"]], symbol="brace"))
    md = d.get("metadata") or {}
    from music21 import metadata

    score.metadata = metadata.Metadata()
    score.metadata.title = str(md.get("title") or "")[:120]
    creators = md.get("creators") or []
    if creators:
        score.metadata.composer = str(creators[0])[:80]
    from music21.musicxml.m21ToXml import GeneralObjectExporter
    import re
    import zipfile

    xml = GeneralObjectExporter(score).parse().decode("utf-8")
    # the score engraver Lune uses trips over <metronome>: keep the words and
    # the playback tempo (<sound tempo>), drop the drawn metronome and empty words
    xml = re.sub(r"<direction-type>\s*<metronome[^>]*>.*?</metronome>\s*</direction-type>", "<direction-type><words/></direction-type>", xml, flags=re.S)
    xml = re.sub(r"<direction[^>]*>\s*<direction-type>\s*<words\s*/>\s*</direction-type>\s*(<staff>\d+</staff>\s*)?(<sound [^>]*/>)\s*</direction>",
                 lambda m_: f"<sound {m_.group(2)[7:-2].strip()}/>", xml)
    xml = re.sub(r"<direction[^>]*>\s*<direction-type>\s*<words\s*/>\s*</direction-type>\s*(<staff>\d+</staff>\s*)?</direction>", "", xml)
    # one copy of each marking per bar
    def _dedupe(mm):
        body = mm.group(0)
        seen_ = set()

        def keep_(d):
            key_ = re.sub(r"\s+", " ", d.group(0))
            if key_ in seen_:
                return ""
            seen_.add(key_)
            return d.group(0)

        return re.sub(r"<direction[ >].*?</direction>", keep_, body, flags=re.S)

    xml = re.sub(r"<measure [^>]*>.*?</measure>", _dedupe, xml, flags=re.S)
    if pickup:
        xml = xml.replace('<measure implicit="no" number="1">', '<measure implicit="yes" number="1">', 1)
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("META-INF/container.xml", '<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>')
        z.writestr("score.musicxml", xml)
    return {"bars": len(order), "notes": len(keep), "repeats": len(end_rep), "endings": len(ending1)}


if __name__ == "__main__":
    print(convert(sys.argv[1], sys.argv[2]))
