# Switching on accounts (Supabase)

Lune works without accounts: the Repertoire, bar notes and review dates live in
the visitor's own browser. Accounts add sync between devices. They use a free
Supabase project; nothing else is needed (no server of your own).

## 1. Create the project (5 minutes)

1. Sign up at <https://supabase.com> and create a **new project** (free tier).
   Pick a region close to your users and keep the database password somewhere safe.
2. Open **SQL Editor → New query**, paste the whole of
   [`supabase/schema.sql`](../supabase/schema.sql) and press **Run**. It creates
   the tables, the row-level-security rules, the private `scores` storage
   bucket and the `delete_my_account` function. Running it again is safe.

## 2. Turn on email sign-in

1. **Authentication → Sign In / Providers → Email**: enabled, with
   *Confirm email* on. Lune signs people in with a one-time email link
   (no passwords).
2. **Authentication → URL Configuration**:
   - *Site URL*: `https://verushkapatel.github.io/lune/`
   - *Redirect URLs*: add `https://verushkapatel.github.io/lune/` and, for local
     testing, `http://127.0.0.1:8000/` and `http://127.0.0.1:8100/lune/`.
3. Optional but recommended before launch: **Authentication → Emails → SMTP
   settings**. Supabase's built-in mailer only sends a few emails an hour; a
   free SMTP service (Resend, Brevo, Postmark…) removes that limit and lets the
   link come from your own address.

## 3. Connect the site

1. **Project Settings → API**: copy the *Project URL* and the *anon public* key.
2. Paste them into [`frontend/lune-config.js`](../frontend/lune-config.js):

   ```js
   window.LUNE_CONFIG = {
     supabaseUrl: "https://YOUR-PROJECT.supabase.co",
     supabaseAnonKey: "eyJ…",
   };
   ```

   The anon key is designed to be public. What keeps data private is the
   row-level security in `schema.sql`: every table only returns rows whose
   `user_id` is the signed-in user, and the storage bucket only serves files
   inside the user's own folder. **Never** put the `service_role` key here.
3. Rebuild and publish the site (`python3 scripts/export_pages.py` then
   `./scripts/publish_pages.sh`).

## What gets stored

| Table | Holds |
| --- | --- |
| `repertoire` | pieces a user is learning: title, composer, status, last practised |
| `bar_notes` | notes on bars (typed, spoken or from a teacher link) |
| `bar_cards` | review schedule for hard bars |
| `stumbles` | wrong notes / hesitations per bar from *Play along* |
| `study_results` | reading-study answers, by participant code only — insert-only from the site; read them in the dashboard (Table editor → Export CSV) |
| storage `scores/<user id>/…` | uploaded MusicXML for pieces in a user's Repertoire |

Users can download everything (Account → *Download my data*) and delete their
account, which removes every row and file (`delete_my_account`).

## Checks done on the schema

The policies were tested on PostgreSQL 16 with Supabase-style `auth` and
`storage` stubs: a user sees only their own rows; another user can't read,
update or delete them; inserting a row with someone else's `user_id` is
refused; storage paths outside one's own folder are refused; anonymous
visitors can add study rows but read none; study rows reject anything that
looks like a name; deleting an account removes all of that user's data and
files and keeps the anonymous study rows.

## Young users

Many pianists are under 18. The sign-in dialog asks under-13s to involve a
parent or guardian. Lune collects no more than the email address and practice
data listed above, shows no ads and has no tracking; check the rules that apply
where you launch (e.g. COPPA in the US, the UK Children's Code) before
promoting accounts to children.
