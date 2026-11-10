# Switching on accounts (Supabase)

Lune uses **email OTP** (an **8-digit** code from Supabase; the app also accepts 6–8). Guests can explore the landing and open
some demo pieces; **Clair de lune** and cloud-kept data need a signed-in account.
Until you paste Supabase keys into `frontend/lune-config.js`, Create account keeps
a **local account on this device** so onboarding still works.

## Product flow

1. Guest landing (immersive feature tour) → **Make Lune yours**
2. Questionnaire (composers, level, aspire, practice, dream) → email → **8-digit code**
3. Post-sign-in **Welcome** moment (“Thank you for choosing Lune”) → **signed-in home**
4. Signed-in home shows recommended pieces (from onboarding prefs) + a concise feature overview
5. Guests keep the marketing landing; Clair de lune and search need sign-in
6. Optional: open Clair de lune / search / repertoire from the personal home

## Wire up email

### 1. Create the project (5 minutes)

1. Sign up at <https://supabase.com> and create a **new project** (free tier).
2. Open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](../supabase/schema.sql) and press **Run**. It creates
   tables, RLS, storage, `delete_my_account`, and `owner_user_count`.

### 2. Turn on email OTP (not magic-link-only)

1. **Authentication → Sign In / Providers → Email**: enabled.
   Keep *Confirm email* on. Lune calls `signInWithOtp` + `verifyOtp` (`type: "email"`).
2. **Authentication → Emails → Templates** — update **both**:
   - **Magic Link**
   - **Confirm sign up**

   Subject (either template):

   ```text
   Your Lune code is {{ .Token }}
   ```

   Body: paste
   [`supabase/email-templates/magic-link.html`](../supabase/email-templates/magic-link.html)
   (or `confirm-signup.html`). The important part is the token, not a button:

   ```html
   <p>Your Lune code is:</p>
   <h1>{{ .Token }}</h1>
   ```

   Do **not** make “Confirm your email” / `{{ .ConfirmationURL }}` the primary CTA.
   A small fallback link is optional; the app expects the OTP token (typically 8 digits).

3. **Authentication → URL Configuration**:
   - *Site URL*: `https://lune.page/`
   - *Redirect URLs*: `https://lune.page/`, `https://verushkapatel.github.io/lune/`,
     and for local testing `http://127.0.0.1:8000/`, `http://127.0.0.1:8100/lune/`.

### 3. Two addresses: `login@` (OTP) and `info@` (mailbox)

| Address | Role |
|---------|------|
| `login@lune.page` | Auth / OTP / system mail (send-only; treat as no-reply) |
| `info@lune.page` | Primary contact / feedback inbox |

Supabase’s built-in mailer is rate-limited. Prefer SMTP + Cloudflare routing:

1. Create a free [Resend](https://resend.com) account and verify the sending domain
   for `lune.page` (DNS records Resend shows you).
2. **Supabase → Project Settings → Authentication → SMTP**:
   - Host / port / user / pass from Resend
   - **Sender email**: `login@lune.page`
   - **Sender name**: `Lune`
   - If the UI exposes **Reply-To**, set it to `info@lune.page`
3. **Cloudflare → Email Routing** for `lune.page`:
   - Enable Email Routing
   - Destination: `verushkapatel@icloud.com` (or another real inbox you control)
   - Custom address `info@lune.page` → that destination (receives mail)
   - Custom address `login@lune.page` → **Drop** / reject inbound (send-only)
4. Paste updated bodies from
   [`supabase/email-templates/`](../supabase/email-templates/) so copy mentions
   `login@` for codes and `info@` for feedback.

The site mailto / `feedbackEmail` should be `info@lune.page` once routing is on.

> **Dashboard-only:** Email templates, SMTP, and Cloudflare routing cannot be
> changed from this repo without Supabase / Resend / Cloudflare API tokens.
> Paste the HTML templates above in the dashboard (≈2 minutes).

### 4. Connect the site

1. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
2. Paste them into [`frontend/lune-config.js`](../frontend/lune-config.js):

   ```js
   window.LUNE_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "eyJ…",
     ownerEmail: "verushkapatel@icloud.com",
     feedbackEmail: "verushkapatel@icloud.com",
   };
   ```

   Never put the *service_role* key in the frontend.

3. Publish (`python3 scripts/export_pages.py` when scores change, then stamp +
   `./scripts/publish_pages.sh`).

## Owner: how many users?

For documentation / Ivy League write-ups — **no public PII**.

### A. In the app (preferred)

1. Sign in on <https://lune.page/> as `verushkapatel@icloud.com`.
2. **More → Owner stats** (user count) or **More → Impact** (users + weeks /
   stumbles / shares).
3. Requires `owner_user_count` / `owner_impact_stats` from `schema.sql` (re-run
   the SQL file if you haven’t since they were added).
4. For essays / screenshots, see [`docs/IMPACT.md`](IMPACT.md).

### B. In the Supabase dashboard

**SQL Editor**:

```sql
select count(*) as users from auth.users;
```

Optional detail (still private to the project owner):

```sql
select date_trunc('day', created_at) as day, count(*)
from auth.users
group by 1
order by 1 desc;
```

## What gets stored

| Table | Holds |
| --- | --- |
| `repertoire` | pieces a user is learning |
| `bar_notes` | notes on bars |
| `bar_cards` | review schedule for hard bars |
| `stumbles` | wrong notes / hesitations from *Play along* |
| `share_links` | opt-in share tokens → minimal JSON payload (local-first; cloud optional) |
| `study_results` | reading-study answers (participant code only) |
| `feedback` | opt-in feedback: role, how they read music, what changed, a 1–5 rating, weeks of use, quote permission. No email. Insert-only for visitors; read by the owner through `owner_feedback()` |
| storage `scores/<user id>/…` | uploaded MusicXML |

Share links are revocable and carry no email. Cloud insert is best-effort; the
app always keeps a local copy so sharing still works offline.

Users can download everything (Account → *Download my data*) and delete their
account (`delete_my_account`).

## Young users

The sign-in dialog asks under-13s to involve a parent or guardian. Lune collects
no more than the email address and practice data listed above, shows no ads and
has no tracking.
