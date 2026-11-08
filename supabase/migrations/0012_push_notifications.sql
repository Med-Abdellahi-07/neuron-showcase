-- Neuron - phase 4 (3/4): notifications (Web Push).
-- Run after 0011. Safe to run more than once.

-- Device subscriptions: one row per device/browser. Users manage only their own subscriptions; sending is done by the server (service_role).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

-- Per-type preferences (default: all enabled). The subscription itself is controlled by the "enable notifications" button on each device.
create table if not exists public.notification_prefs (
  user_id uuid primary key references public.profiles(id) on delete cascade default auth.uid(),
  lesson_tomorrow boolean not null default true,
  schedule_change boolean not null default true,
  new_content boolean not null default true,
  duel boolean not null default true,
  review boolean not null default true,
  announcement boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Log of scheduled sends to prevent duplicates (session tomorrow: once per session; review reminder: once a day)
create table if not exists public.notification_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_log enable row level security;

drop policy if exists push_own on public.push_subscriptions;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists prefs_own on public.notification_prefs;
create policy prefs_own on public.notification_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- notification_log: no policies (server only)

revoke all on public.push_subscriptions, public.notification_prefs, public.notification_log from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions, public.notification_prefs to authenticated;
grant all on public.push_subscriptions, public.notification_prefs, public.notification_log to service_role;

-- Students with reviews due (for the daily reminder) - server only
create or replace function public.review_reminder_targets() returns table(user_id uuid, due integer)
language sql stable security definer set search_path = public as $$
  select r.user_id, count(*)::integer
  from public.review_queue r
  join public.questions q on q.id = r.question_id and q.status = 'published'
  where not r.mastered and r.due_at <= now()
  group by r.user_id
$$;
revoke all on function public.review_reminder_targets() from public, anon, authenticated;
grant execute on function public.review_reminder_targets() to service_role;
