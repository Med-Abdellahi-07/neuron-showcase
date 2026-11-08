-- 0022: replace the visible student points with a hidden abuse cap (after 0021, idempotent)
-- Final decision (neuron-ai-plan.md): no visible limit and no counter. Default 200 requests/day and 10/minute per student, adjustable from /admin/ai.
-- On overrun: "take a short break" + an alert to the super admin. Pressure mode stays as is. Adds the ai_exam flag.

alter table public.ai_settings add column if not exists daily_cap integer not null default 200;
alter table public.ai_settings add column if not exists minute_cap integer not null default 10;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_settings_caps_chk') then
    alter table public.ai_settings add constraint ai_settings_caps_chk
      check (daily_cap between 10 and 5000 and minute_cap between 1 and 120);
  end if;
end $$;

-- ai_exam: the written-exam flag (batch B). Enabled with the other flags for IAA L2 only.
update public.ai_costs set flag = 'ai_exam' where kind = 'exam';
update public.cohorts c set ai_features = c.ai_features || '{"ai_exam":true}'::jsonb
  from public.majors m
 where m.id = c.major_id and m.code = 'IAA' and c.level_code = 'L2'
   and c.ai_features ? 'ai_chat' and not (c.ai_features ? 'ai_exam');

-- Abuse alerts: once per student/day/type. Readable only through the super admin function.
create table if not exists public.ai_alerts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete set null,
  kind text not null check (kind in ('minute', 'daily')),
  day date not null default ((now() at time zone 'utc')::date),
  created_at timestamptz not null default now(),
  unique (user_id, day, kind)
);
alter table public.ai_alerts enable row level security;
revoke all on public.ai_alerts from anon, authenticated;
grant all on public.ai_alerts to service_role;

-- Reservation: counts requests (not points). reason: disabled | break | busy | auth | unknown. alert=true on the first overrun of the day.
create or replace function public.ai_spend(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid; flg text; cap_d integer; cap_m integer; pr numeric; eff integer; day_n integer; min_n integer; lid bigint; ins integer;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select flag into flg from public.ai_costs where kind = p_kind;
  if flg is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  coh := public.my_cohort();
  if coh is null or not public.ai_flag(coh, flg) then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  perform pg_advisory_xact_lock(hashtext('ai_spend:' || uid::text));
  select daily_cap, minute_cap, pressure into cap_d, cap_m, pr from public.ai_settings where id;
  eff := greatest(1, floor(cap_d * coalesce(pr, 1)));
  select count(*) into day_n from public.ai_ledger where user_id = uid and day = (now() at time zone 'utc')::date;
  select count(*) into min_n from public.ai_ledger where user_id = uid and at > now() - interval '1 minute';
  if min_n >= cap_m then
    insert into public.ai_alerts (user_id, cohort_id, kind) values (uid, coh, 'minute') on conflict do nothing;
    get diagnostics ins = row_count;
    return jsonb_build_object('ok', false, 'reason', 'break', 'alert', ins > 0);
  end if;
  if day_n >= eff then
    if day_n < cap_d then -- the reason for refusal is pressure mode, not abuse
      return jsonb_build_object('ok', false, 'reason', 'busy', 'alert', false);
    end if;
    insert into public.ai_alerts (user_id, cohort_id, kind) values (uid, coh, 'daily') on conflict do nothing;
    get diagnostics ins = row_count;
    return jsonb_build_object('ok', false, 'reason', 'break', 'alert', ins > 0);
  end if;
  insert into public.ai_ledger (user_id, cohort_id, kind, points) values (uid, coh, p_kind, 1) returning id into lid;
  return jsonb_build_object('ok', true, 'ledger_id', lid);
end $$;

-- No balance for the student: only the flags and the pressure state
create or replace function public.ai_balance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); coh uuid := public.my_cohort(); pr numeric;
begin
  if uid is null or coh is null then return null; end if;
  select pressure into pr from public.ai_settings where id;
  return jsonb_build_object(
    'pressure', coalesce(pr, 1),
    'flags', jsonb_build_object(
      'ai_chat', public.ai_flag(coh, 'ai_chat'), 'ai_summary', public.ai_flag(coh, 'ai_summary'),
      'ai_qcm', public.ai_flag(coh, 'ai_qcm'), 'ai_duel', public.ai_flag(coh, 'ai_duel'),
      'ai_tools', public.ai_flag(coh, 'ai_tools'), 'ai_exam', public.ai_flag(coh, 'ai_exam')));
end $$;

-- Space flags (no points). The three-parameter function is replaced.
drop function if exists public.set_space_ai(uuid, jsonb, integer);
create or replace function public.set_space_ai(p_cohort uuid, p_flags jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare k text; clean jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  foreach k in array array['ai_chat', 'ai_summary', 'ai_qcm', 'ai_duel', 'ai_tools', 'ai_exam'] loop
    clean := clean || jsonb_build_object(k, coalesce((p_flags ->> k)::boolean, false));
  end loop;
  update public.cohorts set ai_features = clean where id = p_cohort;
  if not found then raise exception 'not_found'; end if;
end $$;

-- Abuse caps: read and edit (super admin only)
create or replace function public.ai_get_limits() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select jsonb_build_object('daily_cap', daily_cap, 'minute_cap', minute_cap, 'pressure', pressure) from public.ai_settings where id);
end $$;
create or replace function public.ai_set_limits(p_daily integer, p_minute integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_daily is null or p_daily < 10 or p_daily > 5000 or p_minute is null or p_minute < 1 or p_minute > 120 then raise exception 'invalid_limits'; end if;
  update public.ai_settings set daily_cap = p_daily, minute_cap = p_minute, updated_at = now() where id;
end $$;

-- Heaviest accounts (requests today and over 7 days) and the latest alerts
create or replace function public.ai_top_users(p_limit integer default 10) returns table(
  user_id uuid, full_name text, space_name text, today bigint, week bigint, last_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select l.user_id, p.full_name, c.name,
           count(*) filter (where l.day = (now() at time zone 'utc')::date)::bigint,
           count(*)::bigint, max(l.at)
    from public.ai_ledger l
    join public.profiles p on p.id = l.user_id
    left join public.cohorts c on c.id = p.cohort_id
    where l.day > (now() at time zone 'utc')::date - 7
    group by l.user_id, p.full_name, c.name
    order by 4 desc, 5 desc limit least(greatest(coalesce(p_limit, 10), 1), 50);
end $$;
create or replace function public.ai_recent_alerts(p_days integer default 7) returns table(
  user_id uuid, full_name text, space_name text, kind text, day date, created_at timestamptz
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select a.user_id, p.full_name, c.name, a.kind, a.day, a.created_at
    from public.ai_alerts a join public.profiles p on p.id = a.user_id left join public.cohorts c on c.id = a.cohort_id
    where a.day > (now() at time zone 'utc')::date - least(greatest(coalesce(p_days, 7), 1), 60)
    order by a.created_at desc limit 50;
end $$;

revoke all on function public.ai_spend(text), public.ai_balance(), public.set_space_ai(uuid, jsonb), public.ai_get_limits(),
  public.ai_set_limits(integer, integer), public.ai_top_users(integer), public.ai_recent_alerts(integer) from public, anon;
grant execute on function public.ai_spend(text), public.ai_balance(), public.set_space_ai(uuid, jsonb), public.ai_get_limits(),
  public.ai_set_limits(integer, integer), public.ai_top_users(integer), public.ai_recent_alerts(integer) to authenticated, service_role;
