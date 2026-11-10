# Offline and loading

## Offline

Lune installs a service worker (`frontend/sw.js`, copied beside `index.html`
by the build). It is **network first**: online, every request goes to the
network exactly as without it, and nothing stale is ever shown. The cache is
only the fallback when the network fails.

On install it keeps the app shell (everything `index.html` names, plus the
fonts its stylesheet names) and three files the page loads on demand:
Tone.js (the piano sound), `search-index.json` and `opens.json` (the
catalogue). Anything else the app fetches while the worker is in charge,
such as a score you open, is kept as it arrives.

So after one visit, with the network gone:

- the app opens on a reload,
- a piece opened before renders with its letter lane,
- search finds pieces,
- the piano sound loads.

`scripts/offline_test.py` checks each of these with real reloads.

It deliberately leaves alone: anything on another origin (Supabase, score
mirrors, piano samples), requests with credentials, and the local Python
server's `/api/`. A new worker waits until every Lune tab is closed, so nobody
is reloaded mid-practice.

## What loads when

Scripts are deferred, so the first screen draws before the JavaScript
arrives. Not part of page load:

| File | Loads when |
| --- | --- |
| Tone.js (~340 KB) | First Play; opening a score warms it up |
| supabase.js (~210 KB) | When the page is idle, or at once if a cloud session or sign-in is under way |
| search-index.json (~100 KB compressed) | Once, when the page is idle; shared by search and setup |
| PDF.js, follow.js | Never in the browser (PDFs go to the desktop app's server; Play along has no interface) |

`scripts/loading_test.py` checks this, that signing in straight away still
gets the emailed code (not a device-only account), and that Play pressed
seconds after opening a score starts sound.

## Measurements

Lighthouse, mobile preset (Moto G Power, slow 4G, 4× CPU), gzip, median of 3:

| | Before | After |
| --- | --- | --- |
| Home: performance score | 54 | 78 |
| Home: first paint | 3.6 s | 1.05 s |
| Home: total blocking time | 875 ms | 104 ms |
| Home: interactive | 8.1 s | 5.9 s |
| Home: bytes | 1.22 MB | 0.79 MB |
| Score page: performance score | 43 | 43 |

A score page is bound by engraving: OSMD lays out every bar and reads back
pixels to space the systems, about 6 s of blocking time under 4× CPU slowdown
(about 3 s unthrottled on a laptop). That is the next thing to work on.
