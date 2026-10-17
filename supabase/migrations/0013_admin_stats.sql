-- Neuron — المرحلة 4 (4/4): إحصائيات المدير.
-- يُنفَّذ بعد 0012. آمن للتنفيذ أكثر من مرة.
-- إحصائيات مجمّعة فقط. المدير والمشرفون لا يقرأون conversations/messages (سياسات 0005 تحصرها بصاحبها).

-- آخر ظهور (يُحدَّث مرة كل 10 دقائق كحد أقصى من المتصفح)
alter table public.profiles add column if not exists last_seen_at timestamptz;

create or replace function public.touch_seen() returns void
language sql security definer set search_path = public as $$
  update public.profiles set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '10 minutes')
$$;

-- عدّاد استهلاك المزوّدين يومياً (Gemini / Groq / Tavily) مقابل حدودهم
create table if not exists public.ai_provider_daily (
  day date not null,
  provider text not null check (provider in ('gemini', 'groq', 'tavily')),
  calls integer not null default 0,
  failures integer not null default 0,
  primary key (day, provider)
);
alter table public.ai_provider_daily enable row level security;
revoke all on public.ai_provider_daily from anon, authenticated;
grant all on public.ai_provider_daily to service_role;

create or replace function public.ai_note_use(p_provider text, p_failed boolean default false, p_n integer default 1) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or p_provider not in ('gemini', 'groq', 'tavily') then return; end if;
  p_n := least(greatest(coalesce(p_n, 1), 1), 1000);
  insert into public.ai_provider_daily as t (day, provider, calls, failures)
  values ((now() at time zone 'utc')::date, p_provider, case when p_failed then 0 else p_n end, case when p_failed then p_n else 0 end)
  on conflict (day, provider) do update
    set calls = t.calls + excluded.calls, failures = t.failures + excluded.failures;
  delete from public.ai_provider_daily where day < (now() at time zone 'utc')::date - 60;
end $$;

-- ───────────────────────── دوال المدير ─────────────────────────
create or replace function public.admin_students() returns table(
  id uuid, full_name text, last_seen_at timestamptz, answers_7d integer, attempts_total integer,
  accuracy numeric, lessons_studied integer, duels_played integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.full_name, p.last_seen_at,
    (select count(*)::integer from public.attempt_answers a where a.user_id = p.id and a.answered_at > now() - interval '7 days'),
    (select count(*)::integer from public.attempts t where t.user_id = p.id),
    (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1) from public.attempt_answers a where a.user_id = p.id),
    (select count(*)::integer from public.lesson_progress lp where lp.user_id = p.id),
    (select count(*)::integer from public.duel_players dp join public.duels d on d.id = dp.duel_id
       where dp.user_id = p.id and d.status in ('completed', 'expired'))
  from public.profiles p
  where p.role = 'student'
  order by p.last_seen_at desc nulls last, p.full_name;
end $$;

-- متوسط الدفعة في كل مادة (نسبة الإجابات الصحيحة) وعدد المشاركين
create or replace function public.admin_subject_stats() returns table(
  subject_id uuid, code text, name text, students integer, answers integer, accuracy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select s.id, s.code, s.name,
    count(distinct a.user_id)::integer, count(a.id)::integer,
    round(100.0 * count(a.id) filter (where a.is_correct) / nullif(count(a.id), 0), 1)
  from public.subjects s
  join public.semesters sem on sem.id = s.semester_id and sem.is_current
  left join public.attempt_answers a on a.subject_id = s.id and a.qtype = 'mcq'
  group by s.id, s.code, s.name, s.sort
  order by s.sort;
end $$;

-- الحصص الأضعف عند أغلبية الطلاب: طالب «ضعيف» في حصة = دقته < 50% بعد 3 إجابات على الأقل فيها.
-- الحصة «ضعيفة» إن ضعف فيها أكثر من نصف من أجاب (اثنان على الأقل).
create or replace function public.admin_weak_lessons(p_limit integer default 12) returns table(
  lesson_id uuid, kind text, number integer, title text, subject_code text,
  students integer, weak_students integer, accuracy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  with per as (
    select q.lesson_id as lid, a.user_id,
           count(*) as n, count(*) filter (where a.is_correct) as c
    from public.attempt_answers a
    join public.questions q on q.id = a.question_id
    join public.profiles p on p.id = a.user_id and p.role = 'student'
    where q.lesson_id is not null and a.qtype = 'mcq'
    group by q.lesson_id, a.user_id
    having count(*) >= 3
  ), agg as (
    select lid, count(*)::integer as students,
           count(*) filter (where c::numeric / n < 0.5)::integer as weak,
           round(100.0 * sum(c) / nullif(sum(n), 0), 1) as acc
    from per group by lid
  )
  select l.id, l.kind, l.number, l.title, s.code, g.students, g.weak, g.acc
  from agg g
  join public.lessons l on l.id = g.lid
  join public.subjects s on s.id = l.subject_id
  where g.students >= 2 and g.weak * 2 > g.students
  order by g.weak::numeric / g.students desc, g.acc asc
  limit least(greatest(p_limit, 1), 50);
end $$;

-- استهلاك الذكاء الاصطناعي يومياً: عدد الاستدعاءات لكل مزوّد (14 يوماً)، مع إخفاقاته
create or replace function public.admin_ai_daily(p_days integer default 14) returns table(
  day date, provider text, calls integer, failures integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select d.day, d.provider, d.calls, d.failures from public.ai_provider_daily d
  where d.day >= (now() at time zone 'utc')::date - (least(greatest(p_days, 1), 60) - 1)
  order by d.day desc, d.provider;
end $$;

-- استهلاك اليوم حسب النوع (من ai_usage): محادثة/بحث/تصحيح/تحليل/جدول، مع عدد الطلاب المستعملين
create or replace function public.admin_ai_kinds() returns table(
  kind text, today integer, last_30d integer, users_today integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select u.kind,
    count(*) filter (where u.at > date_trunc('day', now() at time zone 'utc') at time zone 'utc')::integer,
    count(*)::integer,
    count(distinct u.user_id) filter (where u.at > date_trunc('day', now() at time zone 'utc') at time zone 'utc')::integer
  from public.ai_usage u where u.at > now() - interval '30 days'
  group by u.kind order by u.kind;
end $$;

revoke all on function public.touch_seen() from public, anon;
revoke all on function public.ai_note_use(text, boolean, integer) from public, anon;
revoke all on function public.admin_students() from public, anon;
revoke all on function public.admin_subject_stats() from public, anon;
revoke all on function public.admin_weak_lessons(integer) from public, anon;
revoke all on function public.admin_ai_daily(integer) from public, anon;
revoke all on function public.admin_ai_kinds() from public, anon;
grant execute on function public.touch_seen(), public.ai_note_use(text, boolean, integer), public.admin_students(),
  public.admin_subject_stats(), public.admin_weak_lessons(integer), public.admin_ai_daily(integer),
  public.admin_ai_kinds() to authenticated, service_role;
