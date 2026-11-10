# Measuring Lune's fingering against PIG

Lune suggests a finger for every note using a cost-minimising search over
hand spans (after Parncutt et al.). To find out how close that is to what real
pianists choose, compare it with the **PIG dataset** — 150 piano pieces whose
fingerings were written by pianists, with pieces 001–030 fingered by several
different people.

> E. Nakamura, Y. Saito, K. Yoshii. *Statistical learning and estimation of
> piano fingering.* Information Sciences 517 (2020) 68–85.
> Dataset: <https://beam.kisarazu.ac.jp/~saito/research/PianoFingeringDataset/>
> (free for non-profit research; register and download it yourself).

## Run it

```bash
python3 scripts/pig_benchmark.py --selftest                       # checks the script
python3 scripts/pig_benchmark.py PianoFingeringDataset_v1.2/FingeringFiles --json pig.json
```

Output, one row per piece, then the mean:

| column | meaning |
| --- | --- |
| `M_gen` | match rate with each pianist, averaged — "how often Lune agrees with a pianist" |
| `M_high` | match rate with the pianist Lune agrees with most |
| `M_soft` | a note counts if *any* pianist used Lune's finger |
| `human` | how often the pianists agree with each other — a practical ceiling |

These follow the paper's definitions, so the means can sit next to the
published models' scores for the same 30 pieces in the paper's results table.
Expect even the best numbers to be well short of 100%: pianists often disagree
with each other, and the `human` column shows by how much on each piece.

## How the comparison works

- PIG gives times in seconds, not bars. The script turns them into beats from
  each piece's own pulse (median gap between onsets = an eighth note) so Lune's
  rules for rests and leaps behave as they do on a score.
- Finger substitutions written `3_1` are compared on the first finger (the one
  that strikes the key).
- Each hand is fingered separately, as in Lune.

## Reporting it honestly

Write down the dataset version, the date and the commit of Lune you measured.
If a change to the fingering engine is tuned *on* these 30 pieces, measure it
on pieces 031–150 too (single annotator) so you are not grading your own
homework.
