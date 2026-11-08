-- 0021: personal AI platform (batch A)
-- Daily points per student, AI flags per space, personal summaries, personal QCM, new providers in the usage counter.
-- Idempotent: safe to run more than once. Changes no existing data (except enabling the flags for the IAA L2 space on the first run only).

-- ───────── 1) AI flags and point quota per space ─────────
-- ai_features: ai_chat, ai_summary, ai_qcm, ai_duel, ai_tools. A missing key = disabled.
-- The "ai" plan feature stays the master switch: if it is disabled, all the flags are disabled.
alter table public.cohorts add column if not exists ai_features jsonb not null default '{}'::jsonb;
alter table public.cohorts add column if not exists ai_daily_points integer not null default 30;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cohorts_ai_points_chk') then
    alter table public.cohorts add constraint cohorts_ai_points_chk check (ai_daily_points between 0 and 1000);
  end if;
end $$;

-- Gradual rollout: enabled for IAA L2 only (once: a space whose flags were already set is not touched)
update public.cohorts c
   set ai_features = '{"ai_chat":true,"ai_summary":true,"ai_qcm":true,"ai_duel":true,"ai_tools":true}'::jsonb
  from public.majors m
 where m.id = c.major_id and m.code = 'IAA' and c.level_code = 'L2' and c.ai_features = '{}'::jsonb;

create or replace function public.ai_flag(p_cohort uuid, p_flag text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cohort_feature(p_cohort, 'ai') and coalesce((c.ai_features ->> p_flag)::boolean, false), false)
    from public.cohorts c where c.id = p_cohort
$$;
create or replace function public.my_ai_flag(p_flag text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.ai_flag(public.my_cohort(), p_flag), false)
$$;

-- ───────── 2) Cost of each operation in points + usage ledger + pressure mode ─────────
create table if not exists public.ai_costs (
  kind text primary key,
  points integer not null check (points >= 0),
  flag text not null
);
insert into public.ai_costs (kind, points, flag) values
  ('chat', 1, 'ai_chat'), ('qcm', 3, 'ai_qcm'), ('summary', 5, 'ai_summary'),
  ('errors', 3, 'ai_tools'), ('exam', 5, 'ai_tools'), ('plan', 3, 'ai_tools'), ('flashcards', 2, 'ai_tools')
on conflict (kind) do nothing;

create table if not exists public.ai_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid references public.cohorts(id) on delete set null,
  kind text not null,
  points integer not null,
  day date not null default ((now() at time zone 'utc')::date),
  at timestamptz not null default now()
);
create index if not exists ai_ledger_user_day on public.ai_ledger(user_id, day);
create index if not exists ai_ledger_cohort_day on public.ai_ledger(cohort_id, day);

-- "Pressure mode": a factor that lowers the quotas (1 = normal). Written only by the server (service_role).
create table if not exists public.ai_settings (
  id boolean primary key default true check (id),
  pressure numeric not null default 1 check (pressure >= 0.1 and pressure <= 1),
  updated_at timestamptz not null default now()
);
insert into public.ai_settings (id) values (true) on conflict do nothing;

alter table public.ai_costs enable row level security;
alter table public.ai_ledger enable row level security;
alter table public.ai_settings enable row level security;
drop policy if exists ai_costs_read on public.ai_costs;
create policy ai_costs_read on public.ai_costs for select to authenticated using (true);
drop policy if exists ai_ledger_own on public.ai_ledger;
create policy ai_ledger_own on public.ai_ledger for select to authenticated using (user_id = auth.uid());
revoke all on public.ai_costs, public.ai_ledger, public.ai_settings from anon, authenticated;
grant select on public.ai_costs, public.ai_ledger to authenticated;
grant all on public.ai_costs, public.ai_ledger, public.ai_settings to service_role;

-- Reserve points atomically. Returns {ok, reason: disabled|quota|busy|auth|unknown, remaining, limit, ledger_id}
create or replace function public.ai_spend(p_kind text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid; cost integer; flg text; base_limit integer; pr numeric; eff_limit integer; used integer; lid bigint;
begin
  if uid is null then return jsonb_build_object('ok', false, 'reason', 'auth'); end if;
  select points, flag into cost, flg from public.ai_costs where kind = p_kind;
  if cost is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  coh := public.my_cohort();
  if coh is null or not public.ai_flag(coh, flg) then return jsonb_build_object('ok', false, 'reason', 'disabled'); end if;
  perform pg_advisory_xact_lock(hashtext('ai_spend:' || uid::text));
  select ai_daily_points into base_limit from public.cohorts where id = coh;
  select pressure into pr from public.ai_settings where id;
  eff_limit := floor(base_limit * coalesce(pr, 1));
  select coalesce(sum(points), 0) into used from public.ai_ledger
    where user_id = uid and day = (now() at time zone 'utc')::date;
  if used + cost > eff_limit then
    return jsonb_build_object('ok', false,
      'reason', case when used + cost <= base_limit then 'busy' else 'quota' end,
      'remaining', greatest(eff_limit - used, 0), 'limit', eff_limit);
  end if;
  insert into public.ai_ledger (user_id, cohort_id, kind, points) values (uid, coh, p_kind, cost) returning id into lid;
  return jsonb_build_object('ok', true, 'remaining', eff_limit - used - cost, 'limit', eff_limit, 'ledger_id', lid);
end $$;

-- Refund the points of a failed operation (server only: a student cannot grant themselves points)
create or replace function public.ai_refund(p_ledger_id bigint) returns void
language sql security definer set search_path = public as $$
  delete from public.ai_ledger where id = p_ledger_id
$$;

-- Points remaining today (for the counter) + the flags enabled for my space
create or replace function public.ai_balance() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); coh uuid := public.my_cohort(); base_limit integer; pr numeric; eff integer; used integer;
begin
  if uid is null or coh is null then return null; end if;
  select ai_daily_points into base_limit from public.cohorts where id = coh;
  select pressure into pr from public.ai_settings where id;
  eff := floor(coalesce(base_limit, 0) * coalesce(pr, 1));
  select coalesce(sum(points), 0) into used from public.ai_ledger
    where user_id = uid and day = (now() at time zone 'utc')::date;
  return jsonb_build_object(
    'limit', eff, 'used', used, 'remaining', greatest(eff - used, 0), 'pressure', coalesce(pr, 1),
    'flags', jsonb_build_object(
      'ai_chat', public.ai_flag(coh, 'ai_chat'), 'ai_summary', public.ai_flag(coh, 'ai_summary'),
      'ai_qcm', public.ai_flag(coh, 'ai_qcm'), 'ai_duel', public.ai_flag(coh, 'ai_duel'),
      'ai_tools', public.ai_flag(coh, 'ai_tools')));
end $$;

-- ───────── 3) Super admin: set flags and quota + usage statistics ─────────
create or replace function public.set_space_ai(p_cohort uuid, p_flags jsonb, p_points integer) returns void
language plpgsql security definer set search_path = public as $$
declare k text; clean jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_points is null or p_points < 0 or p_points > 1000 then raise exception 'invalid_points'; end if;
  foreach k in array array['ai_chat', 'ai_summary', 'ai_qcm', 'ai_duel', 'ai_tools'] loop
    clean := clean || jsonb_build_object(k, coalesce((p_flags ->> k)::boolean, false));
  end loop;
  update public.cohorts set ai_features = clean, ai_daily_points = p_points where id = p_cohort;
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.ai_space_usage(p_days integer default 7) returns table(
  cohort_id uuid, space_name text, day date, points bigint, calls bigint, users bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  p_days := least(greatest(coalesce(p_days, 7), 1), 60);
  return query
    select l.cohort_id, c.name, l.day, sum(l.points)::bigint, count(*)::bigint, count(distinct l.user_id)::bigint
    from public.ai_ledger l left join public.cohorts c on c.id = l.cohort_id
    where l.day > (now() at time zone 'utc')::date - p_days
    group by l.cohort_id, c.name, l.day order by l.day desc, c.name;
end $$;

-- New providers in the daily usage counter
do $$ declare cn text; begin
  for cn in select conname from pg_constraint
            where conrelid = 'public.ai_provider_daily'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%provider%' loop
    execute format('alter table public.ai_provider_daily drop constraint %I', cn);
  end loop;
  alter table public.ai_provider_daily add constraint ai_provider_daily_provider_check
    check (provider in ('gemini', 'groq', 'tavily', 'openrouter', 'nvidia', 'github', 'mistral'));
end $$;

create or replace function public.ai_note_use(p_provider text, p_failed boolean default false, p_n integer default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_provider not in ('gemini', 'groq', 'tavily', 'openrouter', 'nvidia', 'github', 'mistral') then return; end if;
  p_n := least(greatest(coalesce(p_n, 1), 1), 1000);
  insert into public.ai_provider_daily as t (day, provider, calls, failures)
  values ((now() at time zone 'utc')::date, p_provider, case when p_failed then 0 else p_n end, case when p_failed then p_n else 0 end)
  on conflict (day, provider) do update
    set calls = t.calls + excluded.calls, failures = t.failures + excluded.failures;
  delete from public.ai_provider_daily where day < (now() at time zone 'utc')::date - 60;
end $$;

-- Latest error per provider: accepts the new providers
do $$ declare cn text; begin
  for cn in select conname from pg_constraint
            where conrelid = 'public.ai_last_error'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%provider%' loop
    execute format('alter table public.ai_last_error drop constraint %I', cn);
  end loop;
  alter table public.ai_last_error add constraint ai_last_error_provider_check
    check (provider in ('gemini', 'groq', 'openrouter', 'nvidia', 'github', 'mistral'));
end $$;
create or replace function public.ai_note_error(p_provider text, p_status integer, p_reason text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_provider not in ('gemini', 'groq', 'openrouter', 'nvidia', 'github', 'mistral') then return; end if;
  insert into public.ai_last_error(provider, status, reason, message, at)
  values (p_provider, p_status, left(p_reason, 200), left(p_message, 600), now())
  on conflict (provider) do update
    set status = excluded.status, reason = excluded.reason, message = excluded.message, at = excluded.at;
end $$;

-- ───────── 4) Personal summaries ─────────
create or replace function public.ai_lessons_ok(p_ids uuid[]) returns boolean
language sql stable set search_path = public as $$ -- invoker: RLS applies, so only a lesson the student can read goes through
  select coalesce(cardinality(p_ids), 0) between 1 and 6
     and not exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.lessons l where l.id = x))
$$;

create table if not exists public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  lesson_ids uuid[] not null,
  kind text not null check (kind in ('short', 'detailed', 'sheet', 'flashcards')),
  lang text not null check (lang in ('ar', 'fr', 'en')),
  title text not null default '',
  content text not null,
  cards jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_summaries_user on public.ai_summaries(user_id, created_at desc);
alter table public.ai_summaries enable row level security;
drop policy if exists ai_summaries_read on public.ai_summaries;
create policy ai_summaries_read on public.ai_summaries for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_summaries_insert on public.ai_summaries;
create policy ai_summaries_insert on public.ai_summaries for insert to authenticated
  with check (user_id = auth.uid() and cohort_id = public.my_cohort() and public.my_ai_flag('ai_summary')
              and public.ai_lessons_ok(lesson_ids));
drop policy if exists ai_summaries_delete on public.ai_summaries;
create policy ai_summaries_delete on public.ai_summaries for delete to authenticated using (user_id = auth.uid());
revoke all on public.ai_summaries from anon, authenticated;
grant select, insert, delete on public.ai_summaries to authenticated;
grant all on public.ai_summaries to service_role;

-- ───────── 5) Personal AI QCM ─────────
create table if not exists public.ai_qcm_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text check (kind in ('cm', 'td', 'tp')),
  lesson_ids uuid[] not null,
  question_count integer not null check (question_count in (5, 10, 20)),
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard')),
  created_at timestamptz not null default now()
);
create table if not exists public.ai_questions (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.ai_qcm_sets(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  page integer,
  statement text not null,
  options jsonb not null,
  correct_index integer not null check (correct_index between 0 and 3),
  explanation text not null,
  selected integer,
  is_correct boolean,
  answered_at timestamptz,
  streak integer not null default 0,
  due_at timestamptz,
  mastered boolean not null default false,
  reported_at timestamptz,
  report_note text,
  report_status text check (report_status in ('open', 'reviewed')),
  created_at timestamptz not null default now(),
  constraint ai_questions_four_options check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) = 4)
);
create index if not exists ai_questions_user on public.ai_questions(user_id, created_at desc);
create index if not exists ai_questions_set on public.ai_questions(set_id);
create index if not exists ai_questions_due on public.ai_questions(user_id, due_at) where not mastered and due_at is not null;
create index if not exists ai_questions_reports on public.ai_questions(subject_id) where report_status = 'open';

alter table public.ai_qcm_sets enable row level security;
alter table public.ai_questions enable row level security;
drop policy if exists ai_sets_read on public.ai_qcm_sets;
create policy ai_sets_read on public.ai_qcm_sets for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_sets_insert on public.ai_qcm_sets;
create policy ai_sets_insert on public.ai_qcm_sets for insert to authenticated
  with check (user_id = auth.uid() and cohort_id = public.my_cohort() and public.my_ai_flag('ai_qcm')
              and public.ai_lessons_ok(lesson_ids)
              and exists (select 1 from public.subjects s where s.id = subject_id));
drop policy if exists ai_sets_delete on public.ai_qcm_sets;
create policy ai_sets_delete on public.ai_qcm_sets for delete to authenticated using (user_id = auth.uid());
drop policy if exists ai_questions_read on public.ai_questions;
create policy ai_questions_read on public.ai_questions for select to authenticated using (user_id = auth.uid());
drop policy if exists ai_questions_insert on public.ai_questions;
create policy ai_questions_insert on public.ai_questions for insert to authenticated
  with check (user_id = auth.uid() and public.my_ai_flag('ai_qcm')
              and exists (select 1 from public.ai_qcm_sets s where s.id = set_id and s.user_id = auth.uid())
              and selected is null and is_correct is null and report_status is null);
revoke all on public.ai_qcm_sets, public.ai_questions from anon, authenticated;
grant select, insert, delete on public.ai_qcm_sets to authenticated;
grant select, insert on public.ai_questions to authenticated; -- no direct update: grading and reporting go through functions
grant all on public.ai_qcm_sets, public.ai_questions to service_role;

-- Grade an answer: the server computes correctness (it never trusts the client) and schedules spaced review. It enters no ranked leaderboard.
create or replace function public.ai_answer_question(p_question uuid, p_selected integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.ai_questions%rowtype; good boolean; new_streak integer;
begin
  select * into r from public.ai_questions where id = p_question and user_id = auth.uid();
  if not found then raise exception 'not_found'; end if;
  if p_selected is null or p_selected < 0 or p_selected > 3 then raise exception 'invalid_choice'; end if;
  good := (p_selected = r.correct_index);
  new_streak := case when good then r.streak + 1 else 0 end;
  update public.ai_questions
     set selected = p_selected, is_correct = good, answered_at = now(), streak = new_streak,
         mastered = (new_streak >= 2),
         due_at = case when good then (case when new_streak >= 2 then null else now() + interval '3 days' end)
                       else now() + interval '1 day' end
   where id = p_question;
  return jsonb_build_object('correct', good, 'correct_index', r.correct_index, 'explanation', r.explanation);
end $$;

-- Spaced review of my mistakes: re-answer a due question (repeats are allowed)
create or replace function public.ai_report_question(p_question uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.ai_questions
     set reported_at = now(), report_status = 'open', report_note = left(coalesce(p_note, ''), 300)
   where id = p_question and user_id = auth.uid();
  if not found then raise exception 'not_found'; end if;
end $$;

-- A moderator sees reported questions for their own space's subjects only, without the student's identity
create or replace function public.reported_ai_questions() returns table(
  id uuid, subject_code text, statement text, options jsonb, correct_index integer, explanation text,
  page integer, note text, reported_at timestamptz, status text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  return query
    select q.id, s.code, q.statement, q.options, q.correct_index, q.explanation, q.page, q.report_note, q.reported_at, q.report_status
    from public.ai_questions q join public.subjects s on s.id = q.subject_id
    where q.report_status is not null and public.subject_cohort(q.subject_id) = public.my_cohort()
    order by (q.report_status = 'open') desc, q.reported_at desc limit 100;
end $$;

create or replace function public.ai_resolve_report(p_question uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  update public.ai_questions set report_status = 'reviewed'
   where id = p_question and public.subject_cohort(subject_id) = public.my_cohort();
  if not found then raise exception 'not_found'; end if;
end $$;

-- ───────── Function privileges ─────────
-- (In Supabase, new functions are granted to authenticated by default: we explicitly revoke what the client must not call)
revoke all on function public.ai_refund(bigint) from authenticated;
revoke all on function public.ai_flag(uuid, text), public.my_ai_flag(text), public.ai_spend(text), public.ai_refund(bigint),
  public.ai_balance(), public.set_space_ai(uuid, jsonb, integer), public.ai_space_usage(integer),
  public.ai_lessons_ok(uuid[]), public.ai_answer_question(uuid, integer), public.ai_report_question(uuid, text),
  public.reported_ai_questions(), public.ai_resolve_report(uuid) from public, anon;
grant execute on function public.ai_flag(uuid, text), public.my_ai_flag(text), public.ai_spend(text), public.ai_balance(),
  public.set_space_ai(uuid, jsonb, integer), public.ai_space_usage(integer), public.ai_lessons_ok(uuid[]),
  public.ai_answer_question(uuid, integer), public.ai_report_question(uuid, text),
  public.reported_ai_questions(), public.ai_resolve_report(uuid) to authenticated;
grant execute on function public.ai_flag(uuid, text), public.my_ai_flag(text), public.ai_spend(text), public.ai_refund(bigint),
  public.ai_balance(), public.set_space_ai(uuid, jsonb, integer), public.ai_space_usage(integer) to service_role;
