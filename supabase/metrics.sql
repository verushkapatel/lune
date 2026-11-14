-- Lune pilot metrics: read-only. Paste into the Supabase SQL editor and Run.
-- It reads what Lune already stores (no tracking added) and changes nothing.
-- "Active" on a day = did something real in Lune that day: wrote a bar note,
-- rated a bar, practised a piece, chatted with Lune AI, or logged a stumble.

with activity as (
  select user_id, created_at::date as day from public.bar_notes
  union all select user_id, updated_at::date from public.bar_cards
  union all select user_id, last_practised_at::date from public.repertoire where last_practised_at is not null
  union all select user_id, updated_at::date from public.chats
  union all select user_id, created_at::date from public.stumbles
),
days as (select distinct user_id, day from activity where user_id is not null),
users as (select id, created_at::date as joined from auth.users),
retained as (
  -- of the accounts at least 30 days old, how many came back on day 30 or later
  select count(*) filter (where exists (select 1 from days d where d.user_id = u.id and d.day >= u.joined + 30)) as back_after_30,
         count(*) as eligible_30,
         count(*) filter (where exists (select 1 from days d where d.user_id = u.id and d.day between u.joined + 1 and u.joined + 7)) as back_in_week_1
  from users u where u.joined <= current_date - 30
)
select
  (select count(*) from users)                                                          as accounts,
  (select count(*) from users where joined > current_date - 7)                          as new_this_week,
  (select count(*) from public.profiles where prefs->>'role' = 'teacher')               as teachers,
  (select count(distinct user_id) from days where day > current_date - 7)               as weekly_active,
  (select count(distinct user_id) from days where day > current_date - 30)              as monthly_active,
  (select round(avg(n), 1) from (select count(*) n from days where day > current_date - 7 group by user_id) w)
                                                                                        as active_days_per_weekly_user,
  (select back_in_week_1 from retained)                                                 as came_back_in_first_week,
  (select back_after_30 from retained)                                                  as still_active_after_30_days,
  (select eligible_30 from retained)                                                    as accounts_30_days_old,
  (select count(*) from public.repertoire)                                              as pieces_in_repertoires,
  (select count(*) from public.bar_cards)                                               as bars_rated,
  (select count(*) from public.assignment_checkins where created_at > now() - interval '7 days')
                                                                                        as homework_checkins_this_week,
  (select count(*) from public.daily_emails where enabled)                              as morning_emails_on;
