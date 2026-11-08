-- Neuron - phase 2: Arena, ranking, mistakes and spaced review.
-- Run after 0001 and 0002 from Supabase -> SQL Editor. Safe to run more than once.
--
-- Security principle: a student reads only their own data and never writes to these tables directly.
-- All grading and scoring happens inside the security definer functions below, so points cannot be forged from the browser.

-- ───────────────────────── Tables ─────────────────────────
create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  cohort_id uuid references public.cohorts(id) on delete set null,
  mode text not null check (mode in ('free', 'ranked', 'review')),
  subject_id uuid references public.subjects(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  question_ids uuid[] not null,
  time_limit_seconds integer check (time_limit_seconds is null or time_limit_seconds > 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total smallint not null,
  answered smallint not null default 0,
  correct smallint not null default 0,
  points numeric(7, 2) not null default 0
);
create index if not exists attempts_user_idx on public.attempts(user_id, started_at desc);

create table if not exists public.attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid references public.questions(id) on delete set null,
  subject_id uuid references public.subjects(id) on delete set null,
  semester_id uuid references public.semesters(id) on delete set null,
  difficulty text not null,
  qtype text not null check (qtype in ('mcq', 'written')),
  selected_index smallint,
  is_correct boolean not null,
  base_points smallint not null default 0,
  bonus_points numeric(5, 2) not null default 0,
  points numeric(5, 2) not null default 0,
  elapsed_ms integer not null default 0,
  is_counted boolean not null default false, -- counts toward the ranking (ranked + first answer to this question)
  answered_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);
create index if not exists answers_user_idx on public.attempt_answers(user_id, answered_at desc);
create index if not exists answers_counted_idx on public.attempt_answers(answered_at) where is_counted;
create index if not exists answers_first_idx on public.attempt_answers(user_id, question_id) where is_counted;

create table if not exists public.review_queue (
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  stage smallint not null default 0 check (stage between 0 and 3), -- 0 = 1 day, 1 = 3 days, 2 = 1 week, 3 = 2 weeks
  due_at timestamptz not null,
  mastered boolean not null default false,
  wrong_count integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, question_id)
);
create index if not exists review_due_idx on public.review_queue(user_id, due_at) where not mastered;

-- ───────────────────────── RLS: a student reads only their own data ─────────────────────────
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.review_queue enable row level security;

drop policy if exists attempts_read_own on public.attempts;
create policy attempts_read_own on public.attempts for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists answers_read_own on public.attempt_answers;
create policy answers_read_own on public.attempt_answers for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists review_read_own on public.review_queue;
create policy review_read_own on public.review_queue for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ───────────────────────── Privileges (GRANT) ─────────────────────────
-- Read-only for users; writes go through functions and service_role only.
revoke all on public.attempts, public.attempt_answers, public.review_queue from anon, authenticated;
grant select on public.attempts, public.attempt_answers, public.review_queue to authenticated;
grant all on public.attempts, public.attempt_answers, public.review_queue to service_role;

-- Block reading the correct answer and explanation straight from the browser (otherwise any technical student could extract
-- the ranked quiz answers with the anon key). The answer is revealed only after recording through submit_answer.
-- Note: select("*") on questions is no longer possible; name the columns explicitly.
revoke select on public.questions from authenticated;
grant select (id, subject_id, lesson_id, type, difficulty, statement, options, model_answer,
              status, created_by, created_at) on public.questions to authenticated;

-- ───────────────────────── Scoring constants ─────────────────────────
-- Difficulty points: easy 1, medium 2, hard 3. Speed bonus up to +50% of the base points,
-- decreasing linearly from full (instant answer) to zero at a reference time of 30/45/60 seconds.
create or replace function public.base_points(p_difficulty text) returns smallint
language sql immutable as $$
  select case p_difficulty when 'easy' then 1 when 'medium' then 2 else 3 end::smallint
$$;

create or replace function public.reference_seconds(p_difficulty text) returns integer
language sql immutable as $$
  select case p_difficulty when 'easy' then 30 when 'medium' then 45 else 60 end
$$;

-- ───────────────────────── Finish an attempt ─────────────────────────
create or replace function public.finish_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.attempts;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  update public.attempts set finished_at = coalesce(finished_at, now())
    where id = p_attempt and user_id = uid
    returning * into a;
  if not found then raise exception 'attempt_not_found'; end if;
  return jsonb_build_object('total', a.total, 'answered', a.answered, 'correct', a.correct, 'points', a.points);
end $$;

-- ───────────────────────── Start an attempt ─────────────────────────
-- ranked: fixed rules (20 QCM questions, 20 minutes, mixed difficulty). The draw is not repeated on page refresh:
--         an in-progress ranked attempt that has not timed out is returned as is.
-- review: the questions due for review today.
-- free: according to the student's options.
create or replace function public.start_attempt(
  p_mode text,
  p_subject uuid default null,
  p_lesson uuid default null,
  p_from integer default null,
  p_to integer default null,
  p_difficulty text default null,
  p_type text default 'mixed',
  p_count integer default 10,
  p_minutes integer default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  n integer;
  limit_s integer;
  new_id uuid;
  existing record;
  c_ranked constant integer := 20;
  min_ranked constant integer := 5;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_mode not in ('free', 'ranked', 'review') then raise exception 'bad_mode'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then p_difficulty := null; end if;
  if p_type not in ('mcq', 'written', 'mixed') then p_type := 'mixed'; end if;

  if p_mode = 'ranked' then
    -- Finish ranked attempts that timed out, and return the one in progress
    update public.attempts set finished_at = now()
      where user_id = uid and mode = 'ranked' and finished_at is null
        and now() > started_at + make_interval(secs => time_limit_seconds + 10);
    select id into existing from public.attempts
      where user_id = uid and mode = 'ranked' and finished_at is null limit 1;
    if found then return existing.id; end if;

    select coalesce(array_agg(id), '{}') into ids from (
      select id from (
        select q.id,
               exists (select 1 from public.attempt_answers aa
                       where aa.user_id = uid and aa.question_id = q.id and aa.is_counted) as seen
        from public.questions q
        where q.status = 'published' and q.type = 'mcq'
          and (p_subject is null or q.subject_id = p_subject)
        order by seen, random()
        limit c_ranked
      ) picked order by random()
    ) shuffled;
    n := coalesce(cardinality(ids), 0);
    if n < min_ranked then raise exception 'not_enough_questions'; end if;
    limit_s := 20 * 60;
    p_lesson := null;
  elsif p_mode = 'review' then
    p_count := least(greatest(coalesce(p_count, 10), 1), 30);
    select coalesce(array_agg(question_id), '{}') into ids from (
      select r.question_id from public.review_queue r
      join public.questions q on q.id = r.question_id and q.status = 'published'
      where r.user_id = uid and not r.mastered and r.due_at <= now()
      order by r.due_at limit p_count
    ) due;
    n := coalesce(cardinality(ids), 0);
    if n = 0 then raise exception 'no_questions'; end if;
    limit_s := null;
  else
    p_count := least(greatest(coalesce(p_count, 10), 1), 50);
    select coalesce(array_agg(id), '{}') into ids from (
      select id from (
        select q.id
        from public.questions q
        left join public.lessons l on l.id = q.lesson_id
        where q.status = 'published'
          and (p_lesson is null or q.lesson_id = p_lesson)
          and (p_lesson is not null or p_subject is null or q.subject_id = p_subject)
          and (p_difficulty is null or q.difficulty = p_difficulty)
          and (p_type = 'mixed' or q.type = p_type)
          and (p_from is null or (l.number is not null and l.number >= p_from))
          and (p_to is null or (l.number is not null and l.number <= p_to))
        order by random()
        limit p_count
      ) picked
    ) pool;
    n := coalesce(cardinality(ids), 0);
    if n = 0 then raise exception 'no_questions'; end if;
    limit_s := case when coalesce(p_minutes, 0) > 0 then least(p_minutes, 180) * 60 else null end;
  end if;

  insert into public.attempts (user_id, cohort_id, mode, subject_id, lesson_id, question_ids, time_limit_seconds, total)
  values (uid, public.my_cohort(), p_mode, case when p_mode = 'review' then null else p_subject end,
          p_lesson, ids, limit_s, n)
  returning id into new_id;
  return new_id;
end $$;

-- ───────────────────────── Record an answer (grading and scoring) ─────────────────────────
-- QCM: p_selected = option index. Written: p_self_correct = result of the self-comparison with the model answer.
-- Time is measured on the server (difference from the last answer or the attempt start). In the ranked quiz this is the only value used
-- (answers are not shown during it, so no time is lost reading the explanation). In free practice the browser may send its
-- actual time p_client_ms to exclude explanation-reading time, provided it does not exceed the server time. Calling twice returns the same result.
create or replace function public.submit_answer(
  p_attempt uuid,
  p_question uuid,
  p_selected integer default null,
  p_self_correct boolean default null,
  p_client_ms integer default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.attempts;
  q public.questions;
  ex public.attempt_answers;
  sem uuid;
  ok boolean;
  elapsed integer;
  last_t timestamptz;
  base smallint;
  bonus numeric(5, 2) := 0;
  pts numeric(5, 2) := 0;
  counted boolean := false;
  factor numeric;
  fin boolean := false;
  intervals constant integer[] := array[1, 3, 7, 14];
  rq public.review_queue;
begin
  if uid is null then raise exception 'not_authenticated'; end if;

  select * into a from public.attempts where id = p_attempt and user_id = uid for update;
  if not found then raise exception 'attempt_not_found'; end if;
  if not (p_question = any (a.question_ids)) then raise exception 'question_not_in_attempt'; end if;

  select * into q from public.questions where id = p_question;
  if not found then raise exception 'question_not_found'; end if;

  select * into ex from public.attempt_answers where attempt_id = p_attempt and question_id = p_question;
  if found then
    return jsonb_build_object('is_correct', ex.is_correct, 'correct_index', q.correct_index,
      'explanation', q.explanation, 'model_answer', q.model_answer, 'points', ex.points,
      'base', ex.base_points, 'bonus', ex.bonus_points, 'counted', ex.is_counted,
      'elapsed_ms', ex.elapsed_ms, 'finished', a.finished_at is not null, 'repeat', true);
  end if;

  if a.finished_at is not null then raise exception 'attempt_finished'; end if;
  if a.time_limit_seconds is not null
     and now() > a.started_at + make_interval(secs => a.time_limit_seconds + 10) then
    update public.attempts set finished_at = now() where id = a.id;
    raise exception 'attempt_expired';
  end if;

  if q.type = 'mcq' then
    if p_selected is null or p_selected < 0 or p_selected >= jsonb_array_length(q.options) then
      raise exception 'bad_answer';
    end if;
    ok := (p_selected = q.correct_index);
  else
    if p_self_correct is null then raise exception 'bad_answer'; end if;
    ok := p_self_correct;
    p_selected := null;
  end if;

  select max(answered_at) into last_t from public.attempt_answers where attempt_id = a.id;
  elapsed := greatest(0, (extract(epoch from (now() - coalesce(last_t, a.started_at))) * 1000)::integer);
  if a.mode <> 'ranked' and p_client_ms is not null and p_client_ms >= 0 then
    elapsed := least(elapsed, p_client_ms);
  end if;

  select semester_id into sem from public.subjects where id = q.subject_id;

  -- Counts toward the ranking: ranked quiz + QCM + the first counted answer to this question by this student
  if a.mode = 'ranked' and q.type = 'mcq' then
    counted := not exists (
      select 1 from public.attempt_answers aa
      where aa.user_id = uid and aa.question_id = q.id and aa.is_counted);
  end if;

  base := public.base_points(q.difficulty);
  -- Points: correct QCM only, in free practice (for display) or the ranked quiz (counted answers only)
  if ok and q.type = 'mcq' and (a.mode = 'free' or counted) then
    factor := greatest(0, 1 - (elapsed / 1000.0) / public.reference_seconds(q.difficulty));
    bonus := round(base * 0.5 * factor, 2);
    pts := base + bonus;
  end if;

  insert into public.attempt_answers
    (attempt_id, user_id, question_id, subject_id, semester_id, difficulty, qtype, selected_index,
     is_correct, base_points, bonus_points, points, elapsed_ms, is_counted)
  values (a.id, uid, q.id, q.subject_id, sem, q.difficulty, q.type, p_selected,
          ok, case when pts > 0 then base else 0 end, bonus, pts, elapsed, counted);

  update public.attempts
    set answered = answered + 1,
        correct = correct + (case when ok then 1 else 0 end),
        points = points + pts,
        finished_at = case when answered + 1 >= total then now() else finished_at end
    where id = a.id
    returning finished_at is not null into fin;

  -- Mistakes are saved automatically: a wrong answer (in any mode) sends the question back to the start of review (after one day)
  if not ok then
    insert into public.review_queue (user_id, question_id, stage, due_at, mastered, wrong_count)
    values (uid, q.id, 0, now() + make_interval(days => intervals[1]), false, 1)
    on conflict (user_id, question_id) do update
      set stage = 0, due_at = now() + make_interval(days => intervals[1]), mastered = false,
          wrong_count = public.review_queue.wrong_count + 1, updated_at = now();
  elsif a.mode = 'review' then
    -- A correct answer in a review session moves it to the next stage (3 days, 1 week, 2 weeks), after which it counts as mastered
    select * into rq from public.review_queue where user_id = uid and question_id = q.id;
    if found and not rq.mastered then
      if rq.stage >= 3 then
        update public.review_queue set mastered = true, updated_at = now()
          where user_id = uid and question_id = q.id;
      else
        update public.review_queue
          set stage = rq.stage + 1, due_at = now() + make_interval(days => intervals[rq.stage + 2]), updated_at = now()
          where user_id = uid and question_id = q.id;
      end if;
    end if;
  end if;

  return jsonb_build_object('is_correct', ok, 'correct_index', q.correct_index,
    'explanation', q.explanation, 'model_answer', q.model_answer, 'points', pts,
    'base', case when pts > 0 then base else 0 end, 'bonus', bonus, 'counted', counted,
    'elapsed_ms', elapsed, 'finished', fin, 'repeat', false);
end $$;

-- ───────────────────────── Review a finished attempt ─────────────────────────
-- Reveals the correct answers and explanations, but only after the attempt ends (or for questions already answered).
create or replace function public.attempt_review(p_attempt uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  a public.attempts;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into a from public.attempts where id = p_attempt and user_id = uid;
  if not found then raise exception 'attempt_not_found'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'question_id', q.id, 'type', q.type, 'difficulty', q.difficulty, 'statement', q.statement,
      'options', q.options, 'correct_index', q.correct_index, 'explanation', q.explanation,
      'model_answer', q.model_answer, 'answered', aa.id is not null, 'is_correct', aa.is_correct,
      'selected_index', aa.selected_index, 'points', aa.points, 'counted', aa.is_counted)
      order by array_position(a.question_ids, q.id))
    from unnest(a.question_ids) with ordinality as t(qid, ord)
    join public.questions q on q.id = t.qid
    left join public.attempt_answers aa on aa.attempt_id = a.id and aa.question_id = q.id
    where a.finished_at is not null or aa.id is not null
  ), '[]'::jsonb);
end $$;

-- ───────────────────────── Ranking within the cohort ─────────────────────────
-- p_scope: 'week' (resets every Monday in the app time zone) or 'semester' (cumulative for the current semester).
-- Only is_counted rows count. Anyone who hid themselves is not shown to others and sees only their own approximate rank.
create or replace function public.leaderboard(p_scope text, p_tz text default 'UTC')
returns table (
  user_id uuid, full_name text, points numeric, answered integer, correct integer,
  accuracy numeric, rank integer, is_me boolean, hidden boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid := public.my_cohort();
  since timestamptz;
  sem uuid;
begin
  if uid is null or coh is null then return; end if;
  if p_scope = 'week' then
    since := date_trunc('week', now() at time zone p_tz) at time zone p_tz;
  else
    select s.id into sem from public.semesters s where s.is_current limit 1;
  end if;

  return query
  with agg as (
    select aa.user_id as uid_, sum(aa.points)::numeric as pts, count(*)::integer as n,
           count(*) filter (where aa.is_correct)::integer as ok
    from public.attempt_answers aa
    join public.profiles p on p.id = aa.user_id and p.cohort_id = coh and p.role = 'student'
    where aa.is_counted
      and (p_scope <> 'week' or aa.answered_at >= since)
      and (p_scope = 'week' or aa.semester_id = sem)
    group by aa.user_id
  ),
  visible as (
    select g.*, p.full_name as nm, p.hide_from_ranking as hid
    from agg g join public.profiles p on p.id = g.uid_
    where not p.hide_from_ranking
  ),
  ranked as (
    select v.*, rank() over (order by v.pts desc, v.ok desc)::integer as rk from visible v
  ),
  mine_hidden as (
    select g.uid_, g.pts, g.n, g.ok, p.full_name as nm,
           1 + (select count(*) from visible v2
                where v2.pts > g.pts or (v2.pts = g.pts and v2.ok > g.ok))::integer as rk
    from agg g join public.profiles p on p.id = g.uid_
    where g.uid_ = uid and p.hide_from_ranking
  )
  select r.uid_, r.nm, r.pts, r.n, r.ok,
         round(100.0 * r.ok / nullif(r.n, 0), 1), r.rk, r.uid_ = uid, false
  from ranked r
  union all
  select m.uid_, m.nm, m.pts, m.n, m.ok, round(100.0 * m.ok / nullif(m.n, 0), 1), m.rk, true, true
  from mine_hidden m
  order by 7, 2;
end $$;

-- ───────────────────────── Function privileges ─────────────────────────
revoke all on function public.start_attempt(text, uuid, uuid, integer, integer, text, text, integer, integer) from public, anon;
revoke all on function public.submit_answer(uuid, uuid, integer, boolean, integer) from public, anon;
revoke all on function public.attempt_review(uuid) from public, anon;
revoke all on function public.finish_attempt(uuid) from public, anon;
revoke all on function public.leaderboard(text, text) from public, anon;
grant execute on function public.start_attempt(text, uuid, uuid, integer, integer, text, text, integer, integer) to authenticated, service_role;
grant execute on function public.submit_answer(uuid, uuid, integer, boolean, integer) to authenticated, service_role;
grant execute on function public.attempt_review(uuid) to authenticated, service_role;
grant execute on function public.finish_attempt(uuid) to authenticated, service_role;
grant execute on function public.leaderboard(text, text) to authenticated, service_role;
