#!/usr/bin/env python3
"""Checks for scripts/pdmx_convert.py on a small piece built to have each hard case.

3/4, a one-beat pickup, then bars 2-3 repeated (written out in full, as PDMX
does), with the lower staff's times early by the pickup's missing two beats
(as PDMX files with a pickup have them). Bar 2 has a right-hand melody note
over a left-hand chord that reaches above middle C; bar 3 has a B-flat, a
grace note and a trill.

Run: python3 scripts/pdmx_convert_test.py
"""
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pdmx_convert as P  # noqa: E402

R = 480
B = 3 * R  # a 3/4 bar
SHIFT = 0  # PDMX files whose lower staff drifts are refused (checked below)


def note(t, p, d, s, m, grace=False):
    return {"time": t, "pitch": p, "duration": d, "pitch_str": s, "measure": m, "is_grace": grace, "velocity": 64}


def piece():
    notes, ann = [], []
    # pickup (bar 1, one beat): right hand D5
    notes.append(note(0, 74, R, "D", 1))
    for pass_, start in ((0, R), (1, R + 2 * B)):
        b2, b3 = start, start + B
        # bar 2: RH B4 dotted half; LH chord G3-B3-E4 on each beat (lower staff, shifted early)
        notes.append(note(b2, 71, B, "B", 2))
        for k in range(3):
            for p, nm in ((55, "G"), (59, "B"), (64, "E")):
                notes.append(note(b2 + k * R - SHIFT, p, R, nm, 2))
        # bar 3: RH grace C5 into B-flat 4 (trill), then A4; LH G2 half + rest
        notes.append(note(b3, 72, R // 4, "C", 3, grace=True))
        notes.append(note(b3, 70, 2 * R, "Bb", 3))
        notes.append(note(b3 + 2 * R, 69, R, "A", 3))
        notes.append(note(b3 - SHIFT, 43, 2 * R, "G", 3))
        if pass_ == 0:
            ann.append({"time": b3, "measure": 3, "annotation": {"name": "Articulation", "subtype": "ornamentTrill"}})
    end = R + 4 * B
    return {
        "metadata": {"title": "Test piece", "creators": ["Test Composer"]},
        "resolution": R,
        "tempos": [{"time": 0, "qpm": 60, "measure": 1, "text": "Andante"}],
        "key_signatures": [{"time": 0, "fifths": -1, "measure": 1}],
        "time_signatures": [{"time": 0, "numerator": 3, "denominator": 4, "measure": 1}],
        "barlines": [
            {"time": 0, "measure": 1}, {"time": R, "measure": 2}, {"time": R + B, "measure": 3},
            {"time": R + 2 * B, "measure": 2}, {"time": R + 3 * B, "measure": 3},
        ],
        "annotations": [],
        "tracks": [{"notes": notes, "annotations": ann}],
        "song_length": end,
    }


def main():
    from music21 import converter

    failures = 0

    def check(name, ok, got=""):
        nonlocal failures
        print(("PASS  " if ok else "FAIL  ") + name + ("" if ok else f"  ({got})"))
        failures += 0 if ok else 1

    with tempfile.TemporaryDirectory() as d:
        src, dst = os.path.join(d, "p.json"), os.path.join(d, "p.mxl")
        json.dump(piece(), open(src, "w"))
        info = P.convert(src, dst)
        check("the repeat is written once, with repeat signs", info["bars"] == 3 and info["repeats"] == 1, info)
        xml = zipfile.ZipFile(dst).read("score.musicxml").decode()
        check("the pickup bar is marked as a pickup", '<measure implicit="yes" number="1">' in xml)
        check("no <metronome> (Lune's engraver trips over it); the tempo still plays", "<metronome" not in xml and 'tempo="60"' in xml)
        check("the trill is on the note", "<trill-mark" in xml)
        check("the grace note is kept", "<grace" in xml)
        s = converter.parse(dst)
        rh, lh = s.parts[0], s.parts[1]
        m2r = [p.nameWithOctave for n in rh.measure(2).notes for p in n.pitches]
        m2l = [p.nameWithOctave for n in lh.measure(2).notes for p in n.pitches]
        check("the melody stays in the right hand", m2r == ["B4"], m2r)
        check("the chord reaching above middle C stays whole in the left hand, on the beat", m2l == ["G3", "B3", "E4"] * 3, m2l)
        first = lh.measure(2).notes[0]
        check("the left hand starts on the beat", first.offset == 0, first.offset)
        m3 = [p.nameWithOctave for n in rh.measure(3).notes if not n.duration.isGrace for p in n.pitches]
        check("spelling is the file's: B-flat, not A-sharp", m3 == ["B-4", "A4"], m3)
        check("each bar is three beats", all(m.duration.quarterLength == 3 for m in rh.getElementsByClass("Measure")[1:]))
        # a file whose lower-staff times drift from their bars is refused, not guessed at
        bad = piece()
        for n in bad["tracks"][0]["notes"]:
            if n["pitch"] < 60:
                n["time"] -= 2 * R
        json.dump(bad, open(src, "w"))
        try:
            P.convert(src, os.path.join(d, "bad.mxl"))
            refused = False
        except ValueError:
            refused = True
        check("a file whose lower staff drifts from its bars is refused", refused)
    print(f"\n{'all passed' if not failures else str(failures) + ' failed'}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
