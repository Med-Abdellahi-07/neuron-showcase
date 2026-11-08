-- Neuron - phase 3: the AI assistant (RAG, conversations, written-answer correction, student analysis).
-- Run after 0001-0004 from Supabase -> SQL Editor. Safe to run more than once.
--
-- Privacy: nothing sent to AI providers is stored here except lesson content, questions
-- and the chat text the student typed. Names, emails and phone numbers are never sent.

-- ───────────────────────── 0) pgvector (before changing default privileges) ─────────────────────────
-- The extension must be created first: functions created after the default privilege is revoked are not executable.
create schema if not exists extensions;
create extension if not exists vector with schema extensions;
grant usage on schema extensions to authenticated, service_role;
grant execute on all functions in schema extensions to authenticated, service_role;

-- ───────────────────────── 1) Restrict helper functions from anon ─────────────────────────
-- Functions are executable by PUBLIC (including anon) by default. We revoke that and grant only to the roles that need them.
-- ping() stays available to anon on purpose (0004).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and p.proname <> 'ping'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- Functions created later are not public by default (each file explicitly grants what it needs)
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;


-- ───────────────────────── 3) Lesson chunks (RAG) ─────────────────────────
alter table public.lesson_files add column if not exists indexed_at timestamptz;
alter table public.lesson_files add column if not exists index_error text;

create table if not exists public.lesson_chunks (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  file_id uuid not null references public.lesson_files(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  page integer not null,
  chunk_index integer not null,
  content text not null,
  embedding extensions.vector(768),
  tsv tsvector generated always as (to_tsvector('french', content)) stored
);
create index if not exists lesson_chunks_lesson_idx on public.lesson_chunks(lesson_id);
create index if not exists lesson_chunks_subject_idx on public.lesson_chunks(subject_id);
create index if not exists lesson_chunks_file_idx on public.lesson_chunks(file_id);
create index if not exists lesson_chunks_tsv_idx on public.lesson_chunks using gin(tsv);

-- ───────────────────────── 4) Conversations ─────────────────────────
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  subject_id uuid references public.subjects(id) on delete set null,
  lesson_id uuid references public.lessons(id) on delete set null,
  mode text not null default 'explain' check (mode in ('explain', 'review', 'solve')),
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists conversations_user_idx on public.conversations(user_id, updated_at desc);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  sources jsonb,
  provider text,
  had_image boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists messages_conv_idx on public.messages(conversation_id, created_at);

-- ───────────────────────── 5) Written-answer correction and student analysis ─────────────────────────
alter table public.attempt_answers add column if not exists ai_score smallint check (ai_score between 0 and 100);
alter table public.attempt_answers add column if not exists ai_feedback text;

create table if not exists public.student_analysis (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  content text not null,
  locale text not null default 'ar',
  generated_at timestamptz not null default now()
);

-- ───────────────────────── 6) Usage limits (hidden) ─────────────────────────
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  at timestamptz not null default now()
);
create index if not exists ai_usage_idx on public.ai_usage(user_id, kind, at desc);

-- ───────────────────────── RLS ─────────────────────────
alter table public.lesson_chunks enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.student_analysis enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists chunks_read on public.lesson_chunks;
create policy chunks_read on public.lesson_chunks for select to authenticated
  using (exists (select 1 from public.lessons l
                 where l.id = lesson_chunks.lesson_id and (l.status = 'published' or public.is_staff())));

drop policy if exists conv_own on public.conversations;
create policy conv_own on public.conversations for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists msg_read on public.messages;
create policy msg_read on public.messages for select to authenticated using (user_id = auth.uid());
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));
drop policy if exists msg_delete on public.messages;
create policy msg_delete on public.messages for delete to authenticated using (user_id = auth.uid());

drop policy if exists analysis_read on public.student_analysis;
create policy analysis_read on public.student_analysis for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists analysis_write on public.student_analysis;
create policy analysis_write on public.student_analysis for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- ai_usage: no user policies; written only through the ai_take function

-- ───────────────────────── GRANT ─────────────────────────
revoke all on public.lesson_chunks, public.conversations, public.messages,
              public.student_analysis, public.ai_usage from anon, authenticated;
grant select on public.lesson_chunks to authenticated;
grant select, insert, update, delete on public.conversations to authenticated;
grant select, insert, delete on public.messages to authenticated;
grant select, insert, update, delete on public.student_analysis to authenticated;
grant all on public.lesson_chunks, public.conversations, public.messages,
             public.student_analysis, public.ai_usage to service_role;

-- ───────────────────────── Functions ─────────────────────────

-- Usage limit: the call is recorded and true is returned, or false if the limit is exceeded.
-- (The short window prevents abuse; the daily one protects the free quota.)
create or replace function public.ai_take(
  p_kind text, p_window_limit integer, p_window_seconds integer, p_day_limit integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n_window integer;
  n_day integer;
begin
  if uid is null then return false; end if;
  delete from public.ai_usage where user_id = uid and at < now() - interval '35 days';
  select count(*) into n_window from public.ai_usage
    where user_id = uid and kind = p_kind and at > now() - make_interval(secs => p_window_seconds);
  select count(*) into n_day from public.ai_usage
    where user_id = uid and kind = p_kind and at > now() - interval '1 day';
  if n_window >= p_window_limit or n_day >= p_day_limit then return false; end if;
  insert into public.ai_usage (user_id, kind) values (uid, p_kind);
  return true;
end $$;

-- Global counter (all students) protecting Tavily's free search quota
create or replace function public.ai_global_count(p_kind text, p_days integer) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer from public.ai_usage
  where kind = p_kind and at > now() - make_interval(days => p_days)
$$;

-- Semantic search over published lesson chunks (RLS applies because the function is security invoker)
create or replace function public.match_chunks(
  p_embedding extensions.vector(768), p_subject uuid default null, p_lesson uuid default null, p_k integer default 6
) returns table (
  id uuid, lesson_id uuid, page integer, content text, similarity real,
  lesson_kind text, lesson_number integer, lesson_title text, subject_code text
)
language sql stable set search_path = public, extensions as $$
  select c.id, c.lesson_id, c.page, c.content,
         (1 - (c.embedding <=> p_embedding))::real,
         l.kind, l.number, l.title, s.code
  from public.lesson_chunks c
  join public.lessons l on l.id = c.lesson_id
  join public.subjects s on s.id = c.subject_id
  where c.embedding is not null
    and (p_lesson is null or c.lesson_id = p_lesson)
    and (p_lesson is not null or p_subject is null or c.subject_id = p_subject)
  order by c.embedding <=> p_embedding
  limit least(greatest(p_k, 1), 20)
$$;

-- Fallback text search when embedding is unavailable
create or replace function public.search_chunks_text(
  p_query text, p_subject uuid default null, p_lesson uuid default null, p_k integer default 6
) returns table (
  id uuid, lesson_id uuid, page integer, content text, similarity real,
  lesson_kind text, lesson_number integer, lesson_title text, subject_code text
)
language sql stable set search_path = public as $$
  select c.id, c.lesson_id, c.page, c.content,
         ts_rank(c.tsv, websearch_to_tsquery('french', p_query))::real,
         l.kind, l.number, l.title, s.code
  from public.lesson_chunks c
  join public.lessons l on l.id = c.lesson_id
  join public.subjects s on s.id = c.subject_id
  where c.tsv @@ websearch_to_tsquery('french', p_query)
    and (p_lesson is null or c.lesson_id = p_lesson)
    and (p_lesson is not null or p_subject is null or c.subject_id = p_subject)
  order by 5 desc
  limit least(greatest(p_k, 1), 20)
$$;

-- Save the AI correction of a written answer (after submit_answer)
create or replace function public.record_ai_grade(
  p_attempt uuid, p_question uuid, p_score integer, p_feedback text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.attempt_answers
    set ai_score = greatest(0, least(100, p_score)), ai_feedback = left(p_feedback, 4000)
    where attempt_id = p_attempt and question_id = p_question and user_id = auth.uid() and qtype = 'written';
end $$;

-- Student statistics for performance analysis (aggregated, no personal data). Only the admin may request them for someone else.
create or replace function public.my_stats(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := coalesce(p_user, auth.uid());
  res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if uid <> auth.uid() and not public.is_admin() then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'answered', count(*), 'correct', count(*) filter (where is_correct),
    'avg_seconds_correct_mcq',
      round((avg(elapsed_ms) filter (where is_correct and qtype = 'mcq') / 1000.0)::numeric, 1)
  ) into res from public.attempt_answers where user_id = uid;

  res := res || jsonb_build_object(
    'by_subject', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'answered', t.n, 'correct', t.ok)
                       order by t.n desc)
      from (select subject_id, count(*) n, count(*) filter (where is_correct) ok
            from public.attempt_answers where user_id = uid group by subject_id) t
      join public.subjects s on s.id = t.subject_id), '[]'::jsonb),
    'by_difficulty', coalesce((
      select jsonb_agg(jsonb_build_object('difficulty', difficulty, 'answered', n, 'correct', ok))
      from (select difficulty, count(*) n, count(*) filter (where is_correct) ok
            from public.attempt_answers where user_id = uid group by difficulty) d), '[]'::jsonb),
    'weak_questions', coalesce((
      select jsonb_agg(jsonb_build_object('statement', left(q.statement, 300), 'subject', s.code,
                                          'wrong_count', r.wrong_count, 'stage', r.stage)
                       order by r.wrong_count desc, r.updated_at desc)
      from (select * from public.review_queue where user_id = uid and not mastered
            order by wrong_count desc, updated_at desc limit 8) r
      join public.questions q on q.id = r.question_id
      join public.subjects s on s.id = q.subject_id), '[]'::jsonb),
    'last_14_days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'answered', n, 'correct', ok) order by d)
      from (select (answered_at at time zone 'UTC')::date d, count(*) n, count(*) filter (where is_correct) ok
            from public.attempt_answers
            where user_id = uid and answered_at > now() - interval '14 days' group by 1) x), '[]'::jsonb),
    'mastered', (select count(*) from public.review_queue where user_id = uid and mastered),
    'in_review', (select count(*) from public.review_queue where user_id = uid and not mastered)
  );
  return res;
end $$;

-- ───────────────────────── Privileges of the new functions ─────────────────────────
revoke all on function public.ai_take(text, integer, integer, integer) from public, anon;
revoke all on function public.ai_global_count(text, integer) from public, anon;
revoke all on function public.match_chunks(extensions.vector, uuid, uuid, integer) from public, anon;
revoke all on function public.search_chunks_text(text, uuid, uuid, integer) from public, anon;
revoke all on function public.record_ai_grade(uuid, uuid, integer, text) from public, anon;
revoke all on function public.my_stats(uuid) from public, anon;
grant execute on function public.ai_take(text, integer, integer, integer) to authenticated, service_role;
grant execute on function public.ai_global_count(text, integer) to authenticated, service_role;
grant execute on function public.match_chunks(extensions.vector, uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.search_chunks_text(text, uuid, uuid, integer) to authenticated, service_role;
grant execute on function public.record_ai_grade(uuid, uuid, integer, text) to authenticated, service_role;
grant execute on function public.my_stats(uuid) to authenticated, service_role;

-- The correct-answer protection from 0003 stays as is: no select is granted on correct_index/explanation.
-- (Reminder: if someone re-runs 0002, run the two statements below)
revoke select on public.questions from authenticated;
grant select (id, subject_id, lesson_id, type, difficulty, statement, options, model_answer,
              status, created_by, created_at) on public.questions to authenticated;
