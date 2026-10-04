# Lune

> **What serves lune.page today.** The live site is the static app in `frontend/`, published to the
> `gh-pages` branch with `scripts/sync_pages_dev.sh` and `scripts/publish_pages.sh` (custom domain in
> `CNAME`). Accounts, sign-in by emailed code and sync use Supabase (`supabase/schema.sql`). Lune AI is
> the Cloudflare Worker in `workers/lune-ai`, deployed by `.github/workflows/deploy-lune-ai.yml`; see
> `docs/AI.md`. The FastAPI app described below (`backend/`, `./run.sh`) is the earlier local version,
> still used to build the score analysis and library, but it is not what visitors to lune.page use.

Open a score. Click where you need help.

Search a piece, or drop **MusicXML**, a **PDF**, or a **photo** of the page. Lune
shows the music itself — not a wall of text. Click a passage for letter names,
fingering, voices, harmony, and how to play that spot. History and playing notes
live under **About**. A practice plan appears only if you ask.

No account needed, no API key for the coach. Free on your machine and at
<https://lune.page>.

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
- **Today's bars** — rate a bar Again, Hard, Okay, Good or Strong after practising it
  and Lune schedules it again just before you'd forget (spaced repetition).
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

The full export (`scripts/export_pages.py`) takes hours and needs the score
cache on the build machine. To test or publish a frontend change, put the
current Pages build in `pages-site/` and copy the frontend over it:

```bash
git worktree add pages-site origin/gh-pages --detach
scripts/sync_pages_dev.sh
mkdir -p /tmp/serve && ln -sfn "$PWD/pages-site" /tmp/serve/lune
(cd /tmp/serve && python3 -m http.server 8137) &
python3 scripts/standin_model_server.py 8139 &
python3 scripts/lune_cloud_test.py         # Ask Lune, install, tabs, ratings, This week, keyboard, catalogue
python3 scripts/contrast_audit.py both      # WCAG AA contrast on every screen, dark and light
python3 scripts/a11y_audit.py               # axe-core on every screen
scripts/lighthouse_install.sh               # installability (Lighthouse 11)
python3 scripts/build_light_theme.py        # after any change to frontend/styles.css
scripts/publish_pages.sh                    # bump the ?v= stamp in frontend/index.html first
```

Ask Lune and Lune AI are described in [docs/AI.md](docs/AI.md).
