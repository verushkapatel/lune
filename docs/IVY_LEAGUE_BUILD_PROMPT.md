# Ivy League impact build prompt (paste into an agent)

Copy everything below the line into a coding agent. Do not dilute the current product.

---

## Mission

You are upgrading **Lune** (`https://lune.page/`, repo: Score Companion / lune) so it becomes a **credible, high-impact piano practice product** that can support an Ivy League application story — without compromising structural integrity, adding clutter, or cheapening the current sleek black/white UI.

**Admissions goal (non-negotiable):** every new surface must produce **evidence of impact** (practice done, hard bars improved, users helped) that Verushka can document. Feature vanity is forbidden.

**Product soul (do not break):** Named for Debussy’s *Clair de lune* — for when practice feels lost, so it can feel right again. Quiet night studio. Free forever. No ads. No payments. Built by a fifteen-year-old.

---

## Hard constraints (UI + architecture)

1. **Additive only.** Extend the existing soft gate, questionnaire → 8-digit OTP → welcome → signed-in home → studio. Do not rebuild the landing, auth, or studio from scratch.
2. **No clutter.** No dashboards of widgets, no emoji, no purple, no gradients, no pill clusters, no floating promo badges, no card farms. One job per section. Apple / Cursor restraint: large type, calm space, black/white.
3. **Preserve guest vs signed-in split:**
   - Guests: immersive marketing landing + feature sims; Clair de lune + search gated.
   - Signed-in: welcome once, then **personal home** (recommendations + concise feature overview) — never restart the guest simulation after OTP / “Enter the studio”.
4. **Keep working systems:** Easy read (never call it “dyslexia” in UI), braille chip, annotate/piano/ask, repertoire, practice plans, follow/stumbles, owner stats (`owner_user_count`), `profiles.prefs` sync, 8-digit OTP, composer portraits.
5. **Brand copy:** Prefer “Lune — so practice feels right again”. Do not revive “quiet piano practice” as the product name/tagline.
6. **Publish** with unique cache-bust stamp via `pages-site` + `./scripts/publish_pages.sh`. No git commit unless explicitly asked.
7. **Privacy:** No public PII. Share links are opt-in, revocable, minimal data. Impact numbers are aggregate/anonymous.
8. **Mobile:** Effortless scroll (no aggressive snap fighting on phones). Studio remains usable on small screens.

---

## What to build (five capabilities — one coherent loop)

Build these as a **single practice loop**, not five disconnected gadgets:

> **Plan → Practice → Stumble map → Review → Recommend next → Share impact (optional)**

Ship in this order. Each phase must look native to the current signed-in home / studio chrome.

### 1) Practice streak + weekly review (evidence engine)

**Why:** Proves the onboarding practice goals are real; creates before/after numbers for essays.

**Requirements:**
- Use existing prefs: practice days/week + minutes, repertoire tasks, review cards, session signals you can honestly derive (opens, play, follow stumbles, task done). Do **not** invent fake gamification (coins, XP, leagues).
- **Streak (quiet):** A single calm line on signed-in home, e.g. “4 days this week · goal 5” — not a fireworks counter.
- **Weekly review** (one beautiful full-screen or modal chapter, once per week or on demand from More / home):
  - Days practiced vs goal
  - Minutes (best-effort; if exact minutes are weak, show “sessions” + bars worked and say so honestly)
  - Bars that improved or were marked Good/Easy vs Again/Hard
  - Top stumble bars (from existing stumbles)
  - One short sentence of encouragement in Lune’s voice (no emoji)
- Persist weekly snapshots in `profiles.prefs` / local store so Owner can later cite trends.
- Entry points: signed-in home (one primary CTA: “This week”), and More menu — nowhere else.

**UI bar:** Feels like a chapter of the product, not a fitness app.

### 2) Stumble map → tonight’s plan (hero loop)

**Why:** This is the product thesis — help when practice feels lost.

**Requirements:**
- Elevate existing **Follow / stumbles** (`follow.js`, `store.stumbleMap`, practice plan tools) into the default “I’m stuck” path.
- From Score (signed-in): after a listen/follow session with stumbles, offer one quiet CTA: **“Make tonight’s 10 minutes”** (duration from prefs when possible).
- Auto-build a short plan: 2–4 hard bars + one easier bar for confidence + optional “hear once” step. Write into existing tasks / repertoire plan — do not invent a second task system.
- From signed-in home: if stumbles exist for the active/recent piece, show one recommendation card: “Tonight: bars … on {piece}”.
- Empty state: one line teaching Follow — no tutorial carousel.

**UI bar:** Same studio language (Score / tools / dock). No new “modes” nav item unless unavoidable; prefer one tool + one CTA.

### 3) Shareable progress page (privacy-safe)

**Why:** Teachers/parents/mentors see impact; distribution without ads.

**Requirements:**
- Opt-in from More or weekly review: **“Share this week”**.
- Creates a read-only link (tokenized) showing *only*:
  - Display name or “A Lune pianist” (user-chosen)
  - Week range
  - Aggregate practice summary (days, sessions/minutes if available)
  - Piece titles they’re comfortable sharing (default: repertoire titles they select; default-off for notes text)
  - **Never** email, raw notes content, or exact home address of bars unless user opts in to “include hard bars”
- Revoke link anytime.
- Visual: public page matches Lune (black/white, serene). No signup wall on the share page; optional “Made with Lune” footer linking to `lune.page`.
- Implement with Supabase (table + RLS) if cloud available; graceful local “copy summary as text” fallback if not.

### 4) Teacher / friend invite (growth without clutter)

**Why:** One clear growth loop for real users (classmates, teachers).

**Requirements:**
- **Invite** from More: generate a link that lands on a short “You’ve been invited to see {name}’s practice week” → share page or a restricted viewer.
- Optional: invitee can create their own Lune account (existing OTP flow) with a soft banner “Invited by a pianist on Lune” — no spammy referral scores.
- Cap complexity: **no** social feed, comments, likes, DMs, or friend graphs. One direction: share progress → invite to try Lune.

### 5) Public impact page (admissions documentation)

**Why:** Essay/interview artifact — anonymized proof the app is used.

**Requirements:**
- Owner-only already has **More → Owner stats** (`owner_user_count`). Extend with an **Impact** view (owner email only, same gate as Owner stats):
  - Total users (existing RPC)
  - Count of practice weeks logged / plans created / stumbles recorded / share links created (aggregate queries or prefs rollups — keep PII out)
  - Simple sparkline or quiet numeric row — not a BI dashboard
- Optional **public** `/impact` (or home footer link for owner-published snapshot): numbers the owner chooses to publish, manually refreshed or nightly rollup — still no PII.
- Add a short `docs/IMPACT.md` explaining how to screenshot/export figures for applications.

---

## Signed-in home integration (where this lives)

Do **not** add a second home. Extend the current signed-in home:

1. **Hero line** — welcome-back / streak (one line).
2. **Tonight** — stumble-derived plan or next recommended piece (one primary block).
3. **Recommended for you** — existing onboarding recommendations / progression (keep).
4. **This week** — entry to weekly review (one secondary block).
5. **Studio tools** — existing concise feature overview (keep; tighten if needed, don’t duplicate the guest sim).
6. Footer / More — Share, Invite, Owner impact (owner only).

If something doesn’t fit, cut copy — never add a sixth competing CTA above the fold.

---

## Data & integrity

- Prefer extending `frontend/store.js`, `practice.js`, `onboard.js`, `follow.js`, `app.js`, `styles.css`, `supabase/schema.sql`.
- New tables only when necessary (e.g. `share_links`, `impact_rollups`) with RLS; document in `docs/ACCOUNTS.md`.
- Weekly review + streak must work **local-first** (device account) and sync when Supabase is configured.
- Be honest when metrics are approximate; never fake engagement.

---

## Quality bar (Ivy + product)

- Feels inevitable and calm — like the current welcome01 / apple-style work, not a startup growth hack.
- Every new string sounds like Lune (teenager maker, sincere, no corporate fluff).
- Accessibility: don’t regress Easy read / braille / keyboard.
- After ship: hard-refresh stamp; verify OTP → welcome → personal home → tonight plan → weekly review → share revoke.
- Provide a short **“Admissions evidence checklist”** in `docs/IMPACT.md`: what to record weekly (users, a case study, screenshots of weekly review).

---

## Out of scope (explicitly do not build)

- Payments, ads, dark patterns, streaks that punish users, leaderboards, AI chatbot replacing the coach panel, marketplace, social feed, notification spam, purple/gradient redesign, renaming Easy read back to dyslexia, guest search, ungated Clair for guests, magic-link-only email regression.

---

## Delivery

1. Implement in the order above (streak/review → stumble→plan → share → invite → impact).
2. Publish with a new stamp (e.g. `impact01`).
3. Return: what shipped, where it lives in the UI, schema changes, how Verushka documents impact for applications, live URL + stamp.

---

## Success definition

A signed-in pianist can: set a weekly practice intention (already from onboarding) → practice with Follow → get **tonight’s bars** → see a **weekly review** → optionally **share** with a teacher → and the owner can see **anonymous impact numbers**. The site remains as sleek as it is now — quieter in the chrome, stronger in the proof.
