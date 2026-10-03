# Decisions

- Default playback uses the written MusicXML tempo map (quarters/min) at 1.0×; the BPM slider scales the whole map for practice. Original marking is shown on the BPM bar; discrete × speed menu remains separate as playRate.
- Playhead tracks engraved note onsets (not a linear measure sweep) and bar downbeats include leading rests so the cursor stays on the sounding bar.
- Metronome uses the piece time signature (accent on beat 1) at the current practice BPM; independent of Play so users can click without leaving.
- Piano tab is a falling-note tutorial above the shared keyboard, synced to the same timeline/BPM as Score.
- Easy read (Atkinson Hyperlegible; formerly labelled “dyslexia”) and Braille chips sit on Overview and Score — not buried only in More. Full Reading & access dialog remains for large print / contrast / read-aloud. Internal ids may still say `dyslexia`.
- Brand name story: Clair de lune is the piece that steadies the maker when lost — told once in About (and lightly in auth copy / footer), not as a marketing strip.
- Clair de lune opens for guests with no sign-in (hero button goes straight to the score), so a first visit sees the real studio. Search stays signed-in-only.
- The landing feature chapters engrave the first four bars of Clair de lune live (`landing-score.js`, data from `scripts/build_landing_excerpt.py`) with the studio's engraver, label lane and piano. Controls in those chapters are real: Notes/Fingers/Off, Play with a tempo slider, tap a bar.
- Notes an edition marks `print-object="no"` are dropped before engraving (`LuneLane.printed`). They exist for playback; drawn, they left stems and ledger lines with no heads (Clair de lune bars 25–26). Sound and analysis still use the full MusicXML.
- Installable app: `manifest.webmanifest` and `sw.js` sit beside `index.html` (the build moves them out of `static/`; the local server has routes for them). Paths are relative so the copy under `github.io/lune/` works too. The worker is network-first for everything same-origin and touches nothing cross-origin (Supabase, score mirrors, piano samples), so being online behaves exactly as before; the cache is only the offline fallback. No `skipWaiting`/`clients.claim`: a new worker waits for tabs to close. “Install Lune” on the landing stays hidden until the browser fires `beforeinstallprompt`, and calls the browser's own prompt.
- Playback is shaped as a performance: ties are held, the sustain pedal follows the score's marks (or changes with the bass and the bar in Romantic and Impressionist pieces that have none), dynamics come from the score, the top line is voiced above the rest, and a small room reverb sits on the piano. Drawn note lengths stay as written.
- Notes / Fingers / Off no longer re-engraves. Letters and fingers are engraved together once (`LuneLane.build` mode `both`, each label tagged with zero-width characters) and the toggle swaps text in place with a fade.
- Play along is removed from the interface. The score toolbar has two worded buttons, Listen and Ask Lune.
- Ask Lune is a rule-based assistant over the score's analysis and the pianist's remarks. It runs in the browser and is not a language model; the interface must not claim otherwise.
- The header's three dots are replaced by Share and Settings dialogs. Privacy is shown inside Settings.
- Braille: `scripts/braille_export.py` then `scripts/braille_retry.py` (notes and rhythm only, flagged `plain` in the index). The Overview says so when a piece has no braille file.
- Setup asks once about dyslexia and visual impairment; reading aids are off unless chosen. Lune relies on the device's own screen reader instead of building audio navigation.
- Light and dark: the app is drawn dark; light mode flips the whole page with a CSS filter and flips pictures and the piano back. The score page always carries its own flip, so it is a dark page in dark mode and a white page in light mode. Choice is in Settings, stored as `lune.theme`.
- Catalogue: 235 piano scores from the ASAP dataset (CC BY-NC-SA 4.0) are listed by `scripts/add_asap_catalog.py` and fetched from GitHub on open, credited under the score. Folder numbers are shown as given, never relabelled as “No.” or opus.
- Mariage d'Amour (Paul de Senneville, mislabelled upstream as a Chopin “Spring Waltz”) and Hungarian Sonata are in copyright: removed from every catalogue file and blocked in `build_remote_catalog.py`.
- A catalogue id or exact query always wins over fuzzy matching when opening a remote score.
- Repertoire shows “Level … (Lune's estimate)” from the analysed difficulty of a piece's hardest bars. It is not an exam grade and is labelled as an estimate.
- Lune AI is local-first and free: `LuneAIProvider` (in `ask.js`) talks to an OpenAI-compatible endpoint on the user's own computer (Ollama by default). No key, no paid service. With no model connected, Ask Lune says so and its rule-based answers are labelled built-in, never as a model's. See docs/AI.md.
- Light theme is `theme-light.css`, generated from `styles.css` by `scripts/build_light_theme.py` (lightness mirrored per colour, muted text darkened, shadows kept dark). Paper surfaces (score page, bar panel) and piano keys are excluded; `scripts/paper_classes.json` lists the bar panel's classes. Run the script after changing `styles.css`.
- Dark mode shows the score page and bar panel dark (a flip filter on those two surfaces only); light mode shows them as white paper.
- `scripts/build_site.sh` is the one clean build. `scripts/blocked.py` is the single block list; `verify_no_blocked.py` gates both the build and publishing.
- Catalogue titles: `normalize_titles.py` replaces opus-only titles with the kind of piece and number the source states; `dedupe_index.py` removes repeated ids and remote copies of bundled works. Arrangements with different titles stay separate entries.
- Tests: `lune_flow_test.py` (flows, AI provider and fallback, music measurements, accessibility, reduced motion, phone), `contrast_audit.py` (both themes), plus the older `claude_pages_test.py` and `claude_practice_test.py`. `claude_follow_test.py` covered Play along and is obsolete.
- Feedback is a form, not a mail link: answers go to the `feedback` table with an explicit quote permission, and the owner view never copies private answers. If the table is unreachable the form offers an email draft.
- Auth email is OTP (`{{ .Token }}`); Magic Link / Confirm signup templates must not lead with “Confirm your email”.
- Home keeps a single search field in the header (compact); the duplicate hero search was removed so results stay wired to `#q`.
- Coach note chips use 12px radius and no lift shadow so chords read as lists, not bubbles.
- Download on Explain opens a menu only when a `.brf` exists; a hidden `.lp-braille` link is created for the download test after opening `#btn-download`.
- Piece-card Remove stays a hidden confirm control; the overflow item clicks it so the two-step “Remove? (press again)” behaviour is unchanged.
- Coach advice “More on this bar” is stored on `window._luneAdviceOpen` for the session only (no storage change).
- Score open is allowlist-only free MusicXML/MXL (musetrainer, OpenScore, etc. via `raw.githubusercontent.com`). Never auto-ingest random PDFs or paid APIs. Fetch-on-open stores credit (source URL + license); UI shows “Fetched from … · license · View source”. Static site uses `remote-catalog.json` + `fetch-score.js`; local API uses the same catalog when resolve misses.

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
