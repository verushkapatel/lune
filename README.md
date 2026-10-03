# Lune

Open a score. Click where you need help.

Search a piece, or drop **MusicXML**, a **PDF**, or a **photo** of the page. Lune
shows the music itself — not a wall of text. Click a passage for letter names,
fingering, voices, harmony, and how to play that spot. History and playing notes
live under **About**. A practice plan appears only if you ask.

No account needed, no API key for the coach. Free on your machine and at
<https://verushkapatel.github.io/lune/>.

## Run

```bash
./run.sh
```

Open http://127.0.0.1:8000

```bash
./build_app.sh
open dist/Lune.app
```

## How to use

1. Search a composer/work, or open a file / the sample  
2. Click the notation (or a spot on a PDF/photo)  
3. Read the dissection for that place  
4. Press **Practice plan** only when you want one  

MusicXML (export from MuseScore) unlocks exact notes and fingering. PDF and
photos show the page for click-to-focus; pair them with MusicXML when you need
the full note breakdown.

## Practice features

- **Repertoire** — type the pieces you're learning and keep them in one place,
  with a status (learning · polishing · ready) and when you last practised.
  Saved in the browser; sign in to sync across devices
  ([docs/ACCOUNTS.md](docs/ACCOUNTS.md)).
- **Notes on bars, typed or spoken** — select a bar and write "play faster
  here", or press **Tell Lune** and say "bar 12, keep the left hand quiet".
  Notes show as markers on the score and are tagged (tempo, dynamics,
  fingering, memory, pedal…).
- **Today's bars** — rate a bar Again / Hard / Good / Easy after practising it
  and Lune schedules it again just before you'd forget (spaced repetition).
- **Play along** — Lune listens through the microphone, follows your place in
  the score, flags wrong notes and hesitations, and draws a stumble map; the
  bars that tripped you go straight into Today's bars. Audio never leaves the
  browser.
- **Teacher links** — select bars, write instructions, and share a link; the
  student opens the piece at those bars and can save the assignment.
- **Reading & access** — bar descriptions read aloud (R), arrow keys from bar
  to bar, large print, an easier-to-read typeface (Atkinson Hyperlegible),
  high contrast, and braille music (.brf) downloads for library pieces.
- **Reading study** (`#/study`) — a 10-minute experiment on whether the letter
  row helps students learn to read ([docs/study-protocol.md](docs/study-protocol.md)).
- **Fingering benchmark** against the PIG dataset
  ([docs/fingering-benchmark.md](docs/fingering-benchmark.md)).

## Tests

```bash
python3 scripts/export_pages.py            # build the static site
(cd pages-site/.. && python3 -m http.server 8100)   # serve it under /lune/
python3 scripts/claude_pages_test.py       # search, catalogue, uploads, links
python3 scripts/claude_practice_test.py    # Repertoire, notes, review, links, access, study
python3 scripts/claude_follow_test.py      # Play along with a synthetic performance
python3 scripts/pig_benchmark.py --selftest
```
