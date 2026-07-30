# Lune

An AI assistant built only for musicians. Ask anything about music, or upload a photo of the page
you're working on and get answers about that specific score.

Lune exists because general assistants are unreliable on what musicians actually need: turning
notation into letter names, separating voices in polyphony, working out fingering that isn't
printed, and explaining what a marking means *in this passage* rather than as a definition.

Lune runs on your own computer. Accounts, settings, and conversations are stored in a local
database, and each person signs in and adds their own AI provider key, so there is no server to
rent and nobody pays for anyone else's usage.

## Run it from source

```bash
cd ~/Projects/score-companion
./run.sh
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000), create an account, and paste an API key
into Settings. Get one from [OpenAI](https://platform.openai.com/api-keys) (`sk-...`) or
[Anthropic](https://console.anthropic.com/settings/keys) (`sk-ant-...`); Lune detects which is
which from the prefix.

## Build the downloadable app

```bash
./build_app.sh
```

This produces `dist/Lune.app` on macOS, `dist/Lune/Lune.exe` on Windows, and `dist/Lune/Lune` on
Linux. The build embeds Python, the parser, and the interface into one double-clickable app with
no install steps for the person receiving it.

PyInstaller cannot cross-compile, so a Windows build has to be produced on Windows and a Mac build
on a Mac. To share the macOS build:

```bash
ditto -c -k --keepParent dist/Lune.app Lune-mac.zip
```

Two things worth knowing before you hand it to anyone. The app is unsigned, so macOS will warn on
first launch and the recipient has to right-click and choose **Open** (or you enroll in the Apple
Developer Program and sign it). And your own `.env` is deliberately never bundled, so every
download starts with no key and asks its user for one.

## Accounts and privacy

- Passwords are hashed with PBKDF2-HMAC-SHA256 over 240,000 rounds and never stored in the clear.
- Your API key is encrypted with a key derived from your password, so it cannot be read out of the
  database without it. The decryption key exists only in memory while you are signed in, which is
  why quitting the app means signing in again.
- Changing your password transparently re-encrypts the stored API key.
- There is no password reset. Nothing leaves the machine, so there is nobody to reset it.
- The database lives in `~/Library/Application Support/Lune` on macOS,
  `%APPDATA%\Lune` on Windows, and `~/.local/share/Lune` on Linux.

## Settings that actually change the answers

| Setting | Effect |
|---|---|
| Instrument | Fingering advice becomes string-and-position for strings, a fingering chart for winds, and breath and tessitura for voice |
| Experience | How much theory is assumed and whether terms get defined |
| Note names | Letters, fixed-do solfege, or German (`H` for B natural) |
| Hand span | Feeds the fingering solver's model of how far the hand opens, not just the wording |
| Length | Concise, balanced, or detailed replies |
| Roman numerals | Turn analysis off in favour of plain chord names |
| Bars in full detail | How much of a long score is sent note by note |
| Provider and model | Override the model chosen from your key |
| Text size, Enter to send | Interface preferences |

## The analysis layer

When you upload **MusicXML** rather than an image, the file is parsed locally and exact data is
given to the model as authoritative context. This is what Lune has that a general chatbot does not.

- **Pitch, rhythm, voices** read directly from the file. All ordering uses MIDI numbers, so
  enharmonics and letter names never distort pitch comparisons. Voice 1 is always the top line.
- **Written key signature** is read from the file. A separate algorithmic key estimate is included
  but labelled as a statistical guess, because that is what it is.
- **Fingering** comes from a cost-minimising search over finger assignments, modelled on the
  relaxed and practical finger spans used in the piano-fingering literature, with penalties for
  the thumb on black keys, awkward crossings, finger slides, and overstretching. On standard
  scales it reproduces the textbook fingering: C major up and down, G, D, and F major, root
  triads, and octaves all come out right. It is a strong starting point, not an edition.
- **Roman numerals** are only generated for real chords of three or more distinct pitches. A
  monophonic melody gets no harmony labels rather than invented ones.
- **Long scores** send note-level detail for the first N bars (80 by default, set per account in
  Settings) and a structural outline for the rest, and the model is told where the detail stops.

Run the checks any time — no API key needed:

```bash
source .venv/bin/activate && python check_lune.py
```

## Attachments

| Type | Behaviour |
|---|---|
| `.png` `.jpg` `.jpeg` `.webp` `.gif` | Sent to the vision model. Good for a quick photo. |
| `.musicxml` `.xml` `.mxl` | Parsed locally into exact note data. Most accurate. |
| `.pdf` | Not readable directly; Lune asks for a screenshot or MusicXML. |

Drag files onto the composer, or paste a screenshot straight from the clipboard. To get MusicXML,
open the piece in MuseScore (free) and choose **File → Export → MusicXML**.

## Accuracy

Reading notes from a photograph is genuinely hard, so Lune is instructed to say when a bar is
blurry, cropped, or ambiguous rather than inventing notes. When MusicXML is uploaded, the parsed
data takes precedence over any image reading and over the model's own recall. For anything
critical, MusicXML is the reliable path.

## Hosting it so nobody needs their own key

Run Lune on a server with your key in the environment and every visitor can just sign up and start
asking. You pay for the usage, so the spend controls below matter.

```bash
# Push to GitHub, then on render.com: New > Blueprint, point it at the repo.
# Set OPENAI_API_KEY in the dashboard. Never commit it.
```

`render.yaml` and `Dockerfile` are ready to go. Any Docker host works the same way.

**Mount a persistent disk at `/data`.** The database is a file; without a disk every redeploy
erases all accounts and conversations. `render.yaml` already declares one.

### Protecting your bill

Your key pays for everyone, so three limits sit in front of it. Requests that spend a *user's own*
key are never counted, since they cost you nothing.

| Variable | Default | What it does |
|---|---|---|
| `LUNE_USER_DAILY_LIMIT` | 40 | Messages per account per day |
| `LUNE_INSTANCE_DAILY_LIMIT` | 400 | Ceiling across all users; a circuit breaker |
| `LUNE_BURST_PER_MINUTE` | 6 | Blunts rapid-fire requests |

Counters live in the database, so they survive restarts. When someone runs out, Lune tells them to
add their own key in Settings, which then costs you nothing and removes their cap.

Also set a hard monthly spend cap in your
[OpenAI billing settings](https://platform.openai.com/settings/organization/limits). Nothing in
this repository can protect you from a mistake in the layer above it.

### Controlling who can sign up

```
LUNE_INVITE_CODE=some-phrase   # signup requires this code
LUNE_ALLOW_SIGNUP=false        # close signups entirely
```

Open signup on a public URL means strangers spending your credit up to the instance ceiling. An
invite code is the simplest way to keep it to people you chose.

### Other hosted settings

```
LUNE_HTTPS=true                       # marks session cookies Secure
LUNE_DATA_DIR=/data                   # where the database lives
LUNE_ALLOWED_ORIGINS=https://your.app # only if a different origin calls the API
```

Cross-origin access is off by default because the interface is served from the same origin as the
API. Run a single worker: sessions and the database assume one process.

### Known limits of the hosted setup

- SQLite and one worker is fine for a few hundred users, not for thousands. Moving to Postgres
  means replacing `backend/store.py`.
- There is no password reset, because there is no email sending.
- Uploaded scores are sent to your AI provider. Say so in a privacy note before charging anyone.

## Structure

```
desktop.py            Native-window entry point used by the packaged app
lune.spec             PyInstaller build definition
build_app.sh          Builds the downloadable app
backend/main.py       API: auth, preferences, threads, chat, analysis
backend/accounts.py   Password hashing, sessions, API key encryption
backend/store.py      Local SQLite database
backend/preferences.py Per-user settings and the prompt they produce
backend/lune.py       Music instructions, vision handling, streaming, provider routing
backend/analyzer.py   MusicXML parsing: pitch, voices, dynamics, articulation, harmony
backend/fingering.py  Cost-based fingering solver
backend/context.py    Turns a parsed score into model context
backend/limits.py     Per-account and instance-wide spend limits for hosted mode
frontend/             Sign-in, chat UI, settings
check_lune.py         Offline checks
Dockerfile            Hosted deployment image
render.yaml           One-click Render blueprint
```

## Roadmap

- Read PDFs directly by rendering pages to images, instead of asking for a screenshot
- Optical music recognition, so photos become exact note data instead of vision reading
- Rendered score view with letter names, voice colours, and fingering on the notation
- MIDI keyboard input for practice loops and live feedback
- Audio upload for intonation and rhythm feedback
- Signed and notarised builds so the app opens without a security warning
