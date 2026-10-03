# Lune impact — admissions evidence

How to document that Lune helps real pianists — for essays, interviews, and
portfolios. Numbers are **anonymous**. Never publish emails or note text.

## Where to look in the product

| Surface | Who | What you get |
|---------|-----|----------------|
| Signed-in home → streak line | Any user | `N days this week · goal M` |
| Signed-in home → **Tonight** | Any user | Stumble-derived bars + “Make tonight’s N minutes” (opens score with bars selected) |
| Signed-in home / More → **This week** | Any user | Weekly review **chapter** (days, sessions, Good/Easy vs Again/Hard, top stumbles, Lune-voice line) |
| More / footer → **Share this week** | Any user | Opt-in read-only link (`#share/<token>`); revocable; copy-summary fallback |
| More / footer → **Invite** | Any user | Invite share page + soft “Invited by a pianist on Lune” on OTP |
| More → **Owner stats** / **Impact** | `verushkapatel@icloud.com` only | User count + aggregate weeks / plans / stumbles / shares |
| `/#impact` | Public only if you publish snapshot | Owner-published anonymous numbers |

## Practice loop (what “impact” means)

1. Onboarding sets practice days × minutes and a dream piece.
2. Pianist uses **Play along** → stumbles land in the map.
3. **Tonight’s plan** writes 2–5 bars into Repertoire tasks (existing task system) and opens the score.
4. Reviews / task done / follow sessions log honest **activity** (local; week rollups sync in `profiles.prefs`).
5. **This week** shows a calm chapter — screenshot this for applications.
6. Optional: **Share this week** with a teacher (no email, no note bodies by default).

## Admissions evidence checklist (weekly)

Do this once a week while Lune has users:

1. Sign in as owner → **More → Impact** → confirm aggregates (users, week reviews, plans, stumbles, shares). Prefer the merged cloud+device numbers; never invent minutes or users.
2. Click **Publish public snapshot** (persists anonymous JSON to Supabase `impact_snapshot`). Open `/#impact` in a **private/incognito** window — you should see quiet aggregate numbers, not “hasn’t published”.
3. **Owner Impact** screenshot — same numbers, no names/emails.
4. **One case study** (classmate / self): piece → hard bars → Play along → tonight’s plan → what improved. 4–6 sentences is enough.
5. **Weekly review** screenshot from a real account (yours is fine): days vs goal + encouragement line (sessions/bars when minutes aren’t exact).
6. Optional: **Share this week** → create link → open `#share/<token>` private window → revoke → confirm “isn’t available”.
7. Note the date and approximate active users in a private doc — not on the public site (beyond what you published).

## SQL (dashboard, owner only)

```sql
select count(*) as users from auth.users;
select count(*) as stumbles from public.stumbles;
select count(*) as shares from public.share_links where revoked = false;
```

Or sign in as owner → **More → Impact** (uses `owner_user_count` + `owner_impact_stats`).

## Schema apply

If share links / impact RPC aren’t live yet, paste the latest
[`supabase/schema.sql`](../supabase/schema.sql) into the Supabase SQL Editor and Run
(safe to re-run; uses `if not exists` / `create or replace`).

Required for this loop:

| Object | Purpose |
|--------|---------|
| `share_links` + RLS | Cloud share tokens; anon can `select` non-revoked rows |
| `owner_user_count` | Owner-only user count |
| `owner_impact_stats` | Owner-only aggregates (weeks / plans via `prefs.planCount` / stumbles / shares) |
| `impact_snapshot` + `publish_impact_snapshot` / `get_impact_snapshot` | Public `/#impact` snapshot (no PII) |
| `feedback` + `owner_feedback` | Opt-in quotes and numbers; anyone may add, only the owner reads |

## Quotes and numbers from real people

Aggregates show the app is used. Words from the people it was built for show it
helped. The goal is about ten pianists and two teachers, with blind and
low-vision musicians first. See [OUTREACH.md](OUTREACH.md) for who to ask and
what to send.

- Anyone can answer at `/#feedback` (footer, More menu, and the landing page's "Who it's for" section).
- Owner: **More → Feedback received** lists every answer, counts progress against 10 + 2, exports CSV, and copies only the answers people allowed to be quoted.
- Guests can open Clair de lune without signing in, so the link you send works on the first tap.

## Honesty rules

- Prefer “sessions” + “bars worked” over invented minutes when wall-clock time isn’t known.
- Never fake streaks, leaderboards, or user counts.
- Plans count is local tasks merged with cloud `prefs.planCount` — not invented.
- Share payloads stay minimal: display name, week aggregates, selected titles, optional hard bars.
- Public `/#impact` only shows what you explicitly publish from Owner Impact (cloud snapshot).
- Never write, edit, or merge a quote. Publish only answers whose quote permission is not private.
