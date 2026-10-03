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
