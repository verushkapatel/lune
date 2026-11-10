-- Lune — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run (once).
-- Every table is private to its owner via row-level security: a signed-in
-- pianist can only ever read or change their own rows.

create extension if not exists "pgcrypto";

-- Profile (display name + onboarding prefs; email lives in Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

-- Repertoire: the pieces a pianist is learning
create table if not exists public.repertoire (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  piece_key text not null check (char_length(piece_key) <= 120),
  title text not null check (char_length(title) <= 200),
  composer text default '' check (char_length(composer) <= 120),
  status text not null default 'learning' check (status in ('learning', 'polishing', 'ready')),
  source text not null default 'catalogue' check (source in ('catalogue', 'upload')),
  score_path text,               -- storage path for uploaded MusicXML
  added_at timestamptz not null default now(),
  last_practised_at timestamptz,
  unique (user_id, piece_key)
);

-- Notes on bars ("play faster here"), typed or spoken, or from a teacher
create table if not exists public.bar_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  piece_key text not null check (char_length(piece_key) <= 120),
  bar integer not null check (bar between 0 and 5000),
  body text not null check (char_length(body) between 1 and 500),
  tags text[] not null default '{}',
  source text not null default 'text' check (source in ('text', 'voice', 'teacher')),
  created_at timestamptz not null default now()
);
create index if not exists bar_notes_piece on public.bar_notes (user_id, piece_key, bar);

-- Spaced-repetition cards for hard bars
create table if not exists public.bar_cards (
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  piece_key text not null check (char_length(piece_key) <= 120),
  bar integer not null check (bar between 0 and 5000),
  ease real not null default 2.5,
  interval_days real not null default 0,
  reps integer not null default 0,
  lapses integer not null default 0,
  due_at timestamptz not null default now(),
  last_grade text,
  updated_at timestamptz not null default now(),
  primary key (user_id, piece_key, bar)
);
create index if not exists bar_cards_due on public.bar_cards (user_id, due_at);

-- Listening sessions: wrong notes and hesitations per bar
create table if not exists public.stumbles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  piece_key text not null check (char_length(piece_key) <= 120),
  bar integer not null check (bar between 0 and 5000),
  wrong integer not null default 0 check (wrong >= 0),
  hesitations integer not null default 0 check (hesitations >= 0),
  created_at timestamptz not null default now()
);
create index if not exists stumbles_piece on public.stumbles (user_id, piece_key);

-- Reading study: anonymous results (participant code only, no names)
create table if not exists public.study_results (
  id uuid primary key default gen_random_uuid(),
  study text not null default 'labels-v1' check (char_length(study) <= 40),
  participant text not null check (participant ~ '^[A-Za-z0-9-]{2,24}$'),
  phase text not null check (phase in ('pre', 'post')),
  condition text not null check (condition in ('labels', 'no-labels')),
  item integer not null,
  answer text check (char_length(answer) <= 4),
  correct boolean not null,
  ms integer not null check (ms between 0 and 120000),
  created_at timestamptz not null default now()
);

-- Opt-in share links (token → minimal anonymous payload). Local-first; cloud optional.
create table if not exists public.share_links (
  token text primary key,
  user_id uuid references auth.users (id) on delete cascade default auth.uid(),
  payload jsonb not null default '{}'::jsonb,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists share_links_user_id_idx on public.share_links (user_id);

alter table public.profiles enable row level security;
alter table public.repertoire enable row level security;
alter table public.bar_notes enable row level security;
alter table public.bar_cards enable row level security;
alter table public.stumbles enable row level security;
alter table public.study_results enable row level security;
alter table public.share_links enable row level security;

drop policy if exists "own share links" on public.share_links;
create policy "own share links" on public.share_links for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Public read of a non-revoked token (share page). No PII required in payload.
drop policy if exists "read share by token" on public.share_links;
create policy "read share by token" on public.share_links for select to anon, authenticated
  using (revoked = false);

-- Owner-only policies
do $$
declare t text;
begin
  foreach t in array array['repertoire', 'bar_notes', 'bar_cards', 'stumbles'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t
    );
  end loop;
end $$;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Study results: anyone may add a row (classroom devices are not signed in);
-- nobody can read them through the public API. The researcher reads them in
-- the Supabase dashboard (Table editor → study_results → Export CSV).
drop policy if exists "add study rows" on public.study_results;
create policy "add study rows" on public.study_results for insert to anon, authenticated with check (true);

-- Delete my account: removes the auth user, which cascades to every row above.
create or replace function public.delete_my_account()
returns void
language sql
security definer
set search_path = public
as $$
  delete from storage.objects where bucket_id = 'scores' and owner = auth.uid();
  delete from auth.users where id = auth.uid();
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Owner-only aggregate for documentation (no PII). Change the email if ownership moves.
create or replace function public.owner_user_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text;
begin
  select lower(email) into caller from auth.users where id = auth.uid();
  if caller is distinct from 'verushkapatel@icloud.com' then
    raise exception 'not allowed';
  end if;
  return (select count(*)::bigint from auth.users);
end;
$$;
revoke all on function public.owner_user_count() from public, anon;
grant execute on function public.owner_user_count() to authenticated;

-- Owner-only anonymous impact rollup (no PII). Used by More → Impact.
-- plans: sum of prefs.planCount across profiles (clients sync an honest local task count).
create or replace function public.owner_impact_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text;
  weeks bigint;
  plans bigint;
begin
  select lower(email) into caller from auth.users where id = auth.uid();
  if caller is distinct from 'verushkapatel@icloud.com' then
    raise exception 'not allowed';
  end if;
  -- Week reviews live in profiles.prefs.weekRollups (json array).
  select coalesce(sum(jsonb_array_length(coalesce(prefs->'weekRollups', '[]'::jsonb))), 0)
    into weeks
  from public.profiles;
  select coalesce(sum(coalesce((prefs->>'planCount')::bigint, 0)), 0)
    into plans
  from public.profiles;
  return jsonb_build_object(
    'users', (select count(*)::bigint from auth.users),
    'weeks', weeks,
    'plans', plans,
    'stumbles', (select count(*)::bigint from public.stumbles),
    'shares', (select count(*)::bigint from public.share_links where revoked = false)
  );
end;
$$;
revoke all on function public.owner_impact_stats() from public, anon;
grant execute on function public.owner_impact_stats() to authenticated;

-- Feedback: what changed for a pianist or teacher, in their own words, plus a
-- few numbers. Sent from the Feedback form (#feedback). No email is stored.
-- Anyone may add a row; nobody can read rows through the public API. The owner
-- reads them with owner_feedback() (More → Feedback received).
-- quote_ok records the consent given: 'no' rows must never be published.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('pianist', 'teacher', 'supporter')),
  reads text[] not null default '{}'
    check (reads <@ array['print', 'large-print', 'screen-reader', 'braille']::text[]),
  helped smallint check (helped between 1 and 5),
  weeks smallint check (weeks between 0 and 520),
  changed text not null check (char_length(changed) between 1 and 1200),
  missing text check (char_length(missing) <= 1200),
  name text check (char_length(name) <= 40),
  quote_ok text not null default 'no' check (quote_ok in ('no', 'anonymous', 'first-name')),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "add feedback" on public.feedback;
create policy "add feedback" on public.feedback for insert to anon, authenticated with check (true);

create or replace function public.owner_feedback()
returns setof public.feedback
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text;
begin
  select lower(email) into caller from auth.users where id = auth.uid();
  if caller is distinct from 'verushkapatel@icloud.com' then
    raise exception 'not allowed';
  end if;
  return query select * from public.feedback order by created_at desc;
end;
$$;
revoke all on function public.owner_feedback() from public, anon;
grant execute on function public.owner_feedback() to authenticated;

-- Public anonymous impact snapshot (owner-published; no PII). Readable by anyone.
create table if not exists public.impact_snapshot (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.impact_snapshot (id, enabled, stats)
values (1, false, '{}'::jsonb)
on conflict (id) do nothing;

alter table public.impact_snapshot enable row level security;
drop policy if exists "read impact snapshot" on public.impact_snapshot;
create policy "read impact snapshot" on public.impact_snapshot
  for select to anon, authenticated
  using (enabled = true);

create or replace function public.publish_impact_snapshot(p_stats jsonb, p_enabled boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller text;
  out_row public.impact_snapshot;
begin
  select lower(email) into caller from auth.users where id = auth.uid();
  if caller is distinct from 'verushkapatel@icloud.com' then
    raise exception 'not allowed';
  end if;
  insert into public.impact_snapshot (id, enabled, stats, updated_at)
  values (
    1,
    coalesce(p_enabled, true),
    coalesce(p_stats, '{}'::jsonb),
    now()
  )
  on conflict (id) do update
    set enabled = excluded.enabled,
        stats = excluded.stats,
        updated_at = now()
  returning * into out_row;
  return jsonb_build_object(
    'enabled', out_row.enabled,
    'stats', out_row.stats,
    'updated_at', out_row.updated_at
  );
end;
$$;
revoke all on function public.publish_impact_snapshot(jsonb, boolean) from public, anon;
grant execute on function public.publish_impact_snapshot(jsonb, boolean) to authenticated;

create or replace function public.get_impact_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.impact_snapshot;
begin
  select * into row from public.impact_snapshot where id = 1;
  if row is null or not row.enabled then
    return jsonb_build_object('enabled', false);
  end if;
  return jsonb_build_object(
    'enabled', true,
    'stats', row.stats,
    'updated_at', row.updated_at
  );
end;
$$;
revoke all on function public.get_impact_snapshot() from public;
grant execute on function public.get_impact_snapshot() to anon, authenticated;

-- Private bucket for uploaded scores: users/<uid>/<file>
insert into storage.buckets (id, name, public)
values ('scores', 'scores', false)
on conflict (id) do nothing;

drop policy if exists "own score files" on storage.objects;
create policy "own score files" on storage.objects for all to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);
