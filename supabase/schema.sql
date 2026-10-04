-- Lune — Supabase schema
-- Paste this whole file into Supabase → SQL Editor → Run (once).
-- Every table is private to its owner via row-level security: a signed-in
-- pianist can only ever read or change their own rows.

create extension if not exists "pgcrypto";

-- Profile (display name only; email lives in Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 60),
  created_at timestamptz not null default now()
);

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

alter table public.profiles enable row level security;
alter table public.repertoire enable row level security;
alter table public.bar_notes enable row level security;
alter table public.bar_cards enable row level security;
alter table public.stumbles enable row level security;
alter table public.study_results enable row level security;

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

-- Private bucket for uploaded scores: users/<uid>/<file>
insert into storage.buckets (id, name, public)
values ('scores', 'scores', false)
on conflict (id) do nothing;

drop policy if exists "own score files" on storage.objects;
create policy "own score files" on storage.objects for all to authenticated
  using (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'scores' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Added October 2026: what the current site uses that the file above lacks.
-- Safe to run more than once. The owner is the account signed in as
-- verushkapatel@icloud.com (the same address as ownerEmail in lune-config.js).
-- ---------------------------------------------------------------------------

-- Settings that follow an account across devices (goal, onboarding answers, plan count)
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;

create or replace function public.is_lune_owner()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'verushkapatel@icloud.com';
$$;

-- Feedback form: anyone may send; only the owner can read, through owner_feedback()
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid default auth.uid() references auth.users (id) on delete set null,
  role text check (char_length(role) <= 40),
  reads text[],
  helped int check (helped between 0 and 10),
  weeks int check (weeks between 0 and 520),
  changed text check (char_length(changed) <= 4000),
  missing text check (char_length(missing) <= 4000),
  name text check (char_length(name) <= 80),
  quote_ok text check (char_length(quote_ok) <= 40),
  message text check (char_length(message) <= 4000),
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "send feedback" on public.feedback;
create policy "send feedback" on public.feedback for insert to anon, authenticated with check (true);

create or replace function public.owner_feedback()
returns setof public.feedback
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_lune_owner() then raise exception 'owner only'; end if;
  return query select * from public.feedback order by created_at desc limit 500;
end $$;
revoke all on function public.owner_feedback() from public, anon;
grant execute on function public.owner_feedback() to authenticated;

-- Share this week: read-only links. The token is the key; revoked links are not readable.
create table if not exists public.share_links (
  token text primary key check (char_length(token) between 8 and 64),
  user_id uuid references auth.users (id) on delete cascade,
  payload jsonb not null,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.share_links enable row level security;
drop policy if exists "make own links" on public.share_links;
create policy "make own links" on public.share_links for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "revoke own links" on public.share_links;
create policy "revoke own links" on public.share_links for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "open live links" on public.share_links;
create policy "open live links" on public.share_links for select to anon, authenticated using (not revoked or user_id = auth.uid());

-- Owner stats
create or replace function public.owner_user_count()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_lune_owner() then raise exception 'owner only'; end if;
  return (select count(*) from auth.users);
end $$;
revoke all on function public.owner_user_count() from public, anon;
grant execute on function public.owner_user_count() to authenticated;

create or replace function public.owner_impact_stats()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_lune_owner() then raise exception 'owner only'; end if;
  return json_build_object(
    'users', (select count(*) from auth.users),
    'plans', (select coalesce(sum(nullif(prefs ->> 'planCount', '')::int), 0) from public.profiles),
    'weeks', (select coalesce(sum(jsonb_array_length(case when jsonb_typeof(prefs -> 'weekRollups') = 'array' then prefs -> 'weekRollups' else '[]'::jsonb end)), 0) from public.profiles),
    'stumbles', (select count(*) from public.stumbles),
    'shares', (select count(*) from public.share_links)
  );
end $$;
revoke all on function public.owner_impact_stats() from public, anon;
grant execute on function public.owner_impact_stats() to authenticated;

-- Public impact page (#impact): the owner publishes anonymous totals; anyone may read them
create table if not exists public.impact_public (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.impact_public enable row level security;

create or replace function public.publish_impact_snapshot(p_stats jsonb, p_enabled boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare r public.impact_public;
begin
  if not public.is_lune_owner() then raise exception 'owner only'; end if;
  insert into public.impact_public (id, enabled, stats, updated_at)
  values (1, p_enabled, coalesce(p_stats, '{}'::jsonb), now())
  on conflict (id) do update set enabled = excluded.enabled, stats = excluded.stats, updated_at = now()
  returning * into r;
  return json_build_object('enabled', r.enabled, 'stats', r.stats, 'updated_at', r.updated_at);
end $$;
revoke all on function public.publish_impact_snapshot(jsonb, boolean) from public, anon;
grant execute on function public.publish_impact_snapshot(jsonb, boolean) to authenticated;

create or replace function public.get_impact_snapshot()
returns json
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select json_build_object('enabled', enabled, 'stats', case when enabled then stats else null end, 'updated_at', updated_at)
     from public.impact_public where id = 1),
    json_build_object('enabled', false)
  );
$$;
grant execute on function public.get_impact_snapshot() to anon, authenticated;
