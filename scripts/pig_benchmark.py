"""Measure Lune's fingering against the PIG piano-fingering dataset.

PIG (Nakamura, Saito & Yoshii, 2020) has 150 pieces fingered by pianists;
pieces 001–030 were fingered by several people each, which is what lets us ask
"how often does Lune pick a finger a real pianist picked?".

The dataset is free for non-profit academic use but must be downloaded by you
(https://beam.kisarazu.ac.jp/~saito/research/PianoFingeringDataset/).
Unzip it and point this script at the folder holding the *_fingering.txt files:

    python3 scripts/pig_benchmark.py path/to/PianoFingeringDataset_v1.2/FingeringFiles
    python3 scripts/pig_benchmark.py --selftest          # synthetic sanity check

File format (one note per line, tab separated):
    noteID onset(s) offset(s) spelledPitch onsetVel offsetVel channel finger
channel 0 = right hand, 1 = left hand; left-hand fingers are negative; a
finger substitution on a held note is written "3_1" (we compare the first,
the finger that strikes the key).

Metrics, as defined in the PIG paper (Nakamura et al. 2020, §4):
    M_gen  match rate with each annotator, averaged over annotators
    M_high match rate with the closest annotator for each piece
    M_soft a note counts if *any* annotator used that finger
Reported for pieces with ≥2 annotators (the paper's evaluation set) and, if
you pass --all, for every file.

Please cite: E. Nakamura, Y. Saito, K. Yoshii. "Statistical learning and
estimation of piano fingering." Information Sciences 517 (2020) 68–85.
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.analyzer import MeasureInfo, NoteInfo, ScoreAnalysis  # noqa: E402
from backend.fingering import suggest_fingering  # noqa: E402

STEP = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
PITCH_RE = re.compile(r"^([A-Ga-g])([#b]*)(-?\d+)$")


def midi_of(spelled: str) -> int:
    m = PITCH_RE.match(spelled.strip())
    if not m:
        raise ValueError(f"pitch {spelled!r}")
    step, acc, octave = m.groups()
    alter = acc.count("#") - acc.count("b")
    return (int(octave) + 1) * 12 + STEP[step.upper()] + alter


def read_pig(path: Path):
    notes = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip() or line.startswith("//"):
            continue
        cols = line.split()
        if len(cols) < 8:
            continue
        finger = cols[7].split("_")[0]
        try:
            f = abs(int(finger))
        except ValueError:
            f = 0
        notes.append(
            {
                "id": int(cols[0]),
                "on": float(cols[1]),
                "off": float(cols[2]),
                "midi": midi_of(cols[3]),
                "pitch": cols[3],
                "hand": "RH" if cols[6] == "0" else "LH",
                "finger": f,
            }
        )
    return notes


def lune_fingers(notes):
    """Run Lune's engine on PIG notes. Times become quarter notes from the
    piece's own pulse (median inter-onset gap = an eighth), so the engine's
    rest and leap rules see musically sensible gaps."""
    onsets = sorted({round(n["on"], 3) for n in notes})
    gaps = [b - a for a, b in zip(onsets, onsets[1:]) if b - a > 0.02]
    eighth = statistics.median(gaps) if gaps else 0.25
    q = 0.5 / eighth  # quarters per second
    t0 = min(n["on"] for n in notes)
    measures: dict[int, MeasureInfo] = {}
    infos = []
    for n in notes:
        pos = (n["on"] - t0) * q
        ql = max(0.0625, (n["off"] - n["on"]) * q)
        num = int(pos // 4) + 1
        info = NoteInfo(
            pitch=n["pitch"],
            letter=n["pitch"][0].upper(),
            octave=0,
            midi=n["midi"],
            duration="",
            quarter_length=ql,
            voice=1,
            staff="1" if n["hand"] == "RH" else "2",
            hand=n["hand"],
            offset=round(pos - (num - 1) * 4, 4),
            beat=None,
            measure=num,
            is_black_key=(n["midi"] % 12) in (1, 3, 6, 8, 10),
        )
        measures.setdefault(num, MeasureInfo(number=num)).notes.append(info)
        infos.append(info)
    # bars with no notes still need to exist so positions stay correct
    for num in range(1, max(measures) + 1):
        measures.setdefault(num, MeasureInfo(number=num))
    analysis = ScoreAnalysis(
        title="", composer=None, notated_key="", analyzed_key="", key_confidence="",
        time_signature="4/4", tempo="", measures=[measures[k] for k in sorted(measures)], parts=[],
    )
    suggest_fingering(analysis)
    return [int(i.fingering or 0) for i in infos]


def evaluate(folder: Path, everything: bool = False):
    by_piece = defaultdict(list)
    for f in sorted(folder.glob("*_fingering.txt")):
        piece, annot = f.name.split("_")[0].split("-")
        by_piece[piece].append(f)
    rows = []
    for piece, files in sorted(by_piece.items()):
        if len(files) < 2 and not everything:
            continue
        truths = [read_pig(f) for f in files]
        base = truths[0]
        # annotators share note lists (same performance); guard anyway
        same = [t for t in truths if len(t) == len(base) and all(a["midi"] == b["midi"] for a, b in zip(t, base))]
        guess = lune_fingers(base)
        per = []
        for t in same:
            ok = sum(1 for g, n in zip(guess, t) if g and g == n["finger"])
            per.append(ok / len(t))
        soft = sum(1 for i, g in enumerate(guess) if g and any(t[i]["finger"] == g for t in same)) / len(base)
        # how much the pianists agree with each other (a ceiling of sorts)
        agree = []
        for i, a in enumerate(same):
            for b in same[i + 1 :]:
                agree.append(sum(1 for x, y in zip(a, b) if x["finger"] == y["finger"]) / len(a))
        rows.append(
            {
                "piece": piece,
                "notes": len(base),
                "annotators": len(same),
                "gen": statistics.mean(per),
                "high": max(per),
                "soft": soft,
                "human": statistics.mean(agree) if agree else None,
            }
        )
    return rows


def report(rows):
    if not rows:
        print("No pieces found. Point the script at the folder with NNN-A_fingering.txt files.")
        return
    print(f"{'piece':>5} {'notes':>5} {'ann':>3}  {'M_gen':>6} {'M_high':>6} {'M_soft':>6}  {'human':>6}")
    for r in rows:
        human = f"{r['human']:.3f}" if r["human"] is not None else "  —  "
        print(f"{r['piece']:>5} {r['notes']:>5} {r['annotators']:>3}  {r['gen']:.3f}  {r['high']:.3f}  {r['soft']:.3f}  {human}")
    mean = lambda k: statistics.mean(r[k] for r in rows)  # noqa: E731
    humans = [r["human"] for r in rows if r["human"] is not None]
    print("-" * 52)
    print(f"{'mean':>5} {sum(r['notes'] for r in rows):>5} {'':>3}  {mean('gen'):.3f}  {mean('high'):.3f}  {mean('soft'):.3f}  "
          f"{statistics.mean(humans):.3f}" if humans else "")
    print("\nCompare with Table 4 of Nakamura et al. (2020) for published models on the same pieces.")


def selftest():
    """Synthetic PIG files with textbook fingerings: checks the reader, the
    conversion and the metrics — not a measure of quality."""
    scale_up = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"]
    rh = [1, 2, 3, 1, 2, 3, 4, 5]
    lh_notes = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"]
    lh = [5, 4, 3, 2, 1, 3, 2, 1]
    d = Path(tempfile.mkdtemp())

    def write(name, fingers_rh, fingers_lh):
        lines = []
        i = 0
        for k, (p, f) in enumerate(zip(scale_up + scale_up[::-1][1:], fingers_rh)):
            lines.append(f"{i}\t{k*0.25:.3f}\t{k*0.25+0.24:.3f}\t{p}\t64\t80\t0\t{f}")
            i += 1
        for k, (p, f) in enumerate(zip(lh_notes, fingers_lh)):
            t = 4 + k * 0.25
            lines.append(f"{i}\t{t:.3f}\t{t+0.24:.3f}\t{p}\t64\t80\t1\t-{f}")
            i += 1
        (d / name).write_text("\n".join(lines) + "\n")

    down = [4, 3, 2, 1, 3, 2, 1]
    write("901-1_fingering.txt", rh + down, lh)
    write("901-2_fingering.txt", rh + down, [5, 4, 3, 2, 1, 4, 3, "2_1"])  # a different, also-valid LH
    assert midi_of("C#4") == 61 and midi_of("Bb3") == 58 and midi_of("C-1") == 0
    rows = evaluate(d)
    report(rows)
    r = rows[0]
    assert r["annotators"] == 2 and r["notes"] == 23
    assert 0 <= r["gen"] <= r["high"] <= r["soft"] <= 1
    assert r["human"] < 1 and r["gen"] < r["high"]
    assert r["high"] > 0.8, f"textbook scales should mostly match, got {r['high']:.2f}"
    print("\nselftest ok")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", nargs="?")
    ap.add_argument("--all", action="store_true", help="also score single-annotator pieces")
    ap.add_argument("--json", help="write per-piece results here")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest or not a.folder:
        selftest()
    else:
        res = evaluate(Path(a.folder), a.all)
        report(res)
        if a.json:
            Path(a.json).write_text(json.dumps(res, indent=2))
