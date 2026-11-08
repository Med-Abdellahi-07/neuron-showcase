-- ════════════════════════════════════════════════════════════════════════════
-- 0016 - QCM download as a PDF (print) + "ranked quiz only" questions
--   - questions.exam_only: a question hidden from free practice and QCM downloads, shown in the ranked quiz only.
--       Default false. The admin edits it from the questions panel or an optional column in the bulk upload.
--   - start_attempt: free practice excludes exam_only (the ranked quiz is unchanged).
--   - qcm_downloads: download log used to limit each student to 10 downloads per 24 hours. Completely closed to the browser
--                    (RLS enabled with no policies + all privileges revoked); only the qcm_export function reaches it.
--   - qcm_export(...): questions and answers are fetched on the server only. No select on questions from the browser.
--       Published QCM only, without exam_only, with the same filters as practice (subject/lesson/range/difficulty), 1..50 questions, optional shuffle,
--       and the explanation is returned only if requested. It returns the correct answer (that is the point: the answers page at the end of the file).
-- Idempotent. Never re-run 0002.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.questions add column if not exists exam_only boolean not null default false;

-- Column privileges have been explicit since 0003; the new column is not sensitive (no answer or explanation) and the admin view needs it
grant select (exam_only) on public.questions to authenticated;

-- ───────────────────────── Free practice excludes exam_only ─────────────────────────
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
          and not q.exam_only -- reserved for the ranked quiz only: not shown in free practice
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

-- ───────────────────────── Download log (closed to the browser) ─────────────────────────
create table if not exists public.qcm_downloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  question_count integer not null default 0
);
create index if not exists qcm_downloads_user_idx on public.qcm_downloads(user_id, created_at desc);
alter table public.qcm_downloads enable row level security;
revoke all on public.qcm_downloads from anon, authenticated;
grant all on public.qcm_downloads to service_role;

-- ───────────────────────── Fetch questions for download ─────────────────────────
create or replace function public.qcm_export(
  p_subject uuid default null,
  p_lesson uuid default null,
  p_from integer default null,
  p_to integer default null,
  p_difficulty text default null,
  p_count integer default 20,
  p_shuffle boolean default true,
  p_explain boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  c_daily_limit constant integer := 10;
  used integer;
  lim integer;
  l_kind text;
  l_number integer;
  l_title text;
  subj uuid := p_subject;
  result jsonb;
  n integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then p_difficulty := null; end if;
  lim := least(greatest(coalesce(p_count, 20), 1), 50);

  -- Prevents a race between two simultaneous requests from the same student
  perform pg_advisory_xact_lock(hashtext('qcm_export:' || uid::text));
  select count(*) into used from public.qcm_downloads
    where user_id = uid and created_at > now() - interval '24 hours';
  if used >= c_daily_limit then raise exception 'download_limit'; end if;

  if p_lesson is not null then
    select l.kind, l.number, l.title, l.subject_id into l_kind, l_number, l_title, subj from public.lessons l where l.id = p_lesson;
    if not found then subj := p_subject; end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'n', t.rn,
           'statement', t.statement,
           'options', t.options,
           'correct', t.correct_index,
           'explanation', case when p_explain then t.explanation else null end
         ) order by t.rn), '[]'::jsonb)
    into result
  from (
    select row_number() over () as rn, p.* from (
      select q.statement, q.options, q.correct_index, q.explanation
      from public.questions q
      left join public.lessons l on l.id = q.lesson_id
      where q.status = 'published' and q.type = 'mcq' and not q.exam_only
        and (p_lesson is null or q.lesson_id = p_lesson)
        and (p_lesson is not null or subj is null or q.subject_id = subj)
        and (p_difficulty is null or q.difficulty = p_difficulty)
        and (p_from is null or (l.number is not null and l.number >= p_from))
        and (p_to is null or (l.number is not null and l.number <= p_to))
      order by case when p_shuffle then random() end, l.number nulls last, q.created_at
      limit lim
    ) p
  ) t;

  n := jsonb_array_length(result);
  if n = 0 then raise exception 'no_questions'; end if;

  insert into public.qcm_downloads (user_id, question_count) values (uid, n);

  return jsonb_build_object(
    'subject_id', subj,
    'lesson', case when l_number is null then null
                   else jsonb_build_object('kind', l_kind, 'number', l_number, 'title', l_title) end,
    'remaining', c_daily_limit - used - 1,
    'questions', result
  );
end $$;

revoke all on function public.qcm_export(uuid, uuid, integer, integer, text, integer, boolean, boolean) from public, anon;
grant execute on function public.qcm_export(uuid, uuid, integer, integer, text, integer, boolean, boolean) to authenticated, service_role;
