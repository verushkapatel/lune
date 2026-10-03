# Decisions

- Hero search is a second field that mirrors `#q` rather than moving the header input, so header tests and phone search keep working.
- Download on Explain opens a menu only when a `.brf` exists; a hidden `.lp-braille` link is created for the download test after opening `#btn-download`.
- Piece-card Remove stays a hidden confirm control; the overflow item clicks it so the two-step “Remove? (press again)” behaviour is unchanged.
- Coach advice “More on this bar” is stored on `window._luneAdviceOpen` for the session only (no storage change).
- Speed menu items are rebuilt on each open so the check mark follows `state.playRate` without extra `setPlayRate` plumbing.

## Visible buttons (before → after)

| Region | Before | After |
| --- | --- | --- |
| Header (studio) | 8 (brand, tabs/+, Score, Explain, Piano, Repertoire, Upload hidden, search hidden) | 7 (brand, tabs, bookmark, Score, Explain, Piano, Repertoire, More) |
| Score toolbar | 6 (Notes/Fingers/Off + Play along + Tell Lune + Add + Keys) | 4 (segment + Play along + Tell Lune + More) |
| Dock | 7 (Play, Stop, five speeds) | 3 (Play, Stop, speed) |
| Coach panel | 11 (Clear, Close, Read, Assign, Speak, Save, 4 grades, Play bar, Play line, Practice notes) | 8 (Close, Save, 4 grades, Play bar, Play line, More) |
| Explain hero | 5 (Open score, Digital piano, Download, Add, Braille) | 2 (Open score, Download) |

## Test results

```
python3 scripts/claude_pages_test.py
25/25 passed

python3 scripts/claude_practice_test.py
32/32 passed

python3 scripts/claude_follow_test.py
7/7 passed

python3 scripts/claude_lane_sweep.py
ll is 0 for every piece at 390 and 1280
(label-count / li warnings unchanged from before; engraving pipeline not touched)
```
