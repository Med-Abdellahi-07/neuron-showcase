-- ════════════════════════════════════════════════════════════════════════════
-- 0018 — عزل الفضاءات في قاعدة البيانات (RLS) وقفل ميزات الخطة على الخادم
--
-- المبدأ: كل ما يخص فضاءً (المواد، الدروس، الملفات، الأسئلة، الجدول، الإعلانات، التسجيلات، الحسابات…) لا يظهر
-- لغيره، ولا يُكتب فيه من غيره، حتى لو حاول المستخدم استدعاء الواجهة البرمجية مباشرة. الحصر يتم عبر my_cohort():
-- فضاء المستخدم الحالي (والمشرف العام «يدخل» فضاءً بتغيير cohort_id في ملفه، فيعمل بصلاحيات مشرفه داخله فقط).
-- ما يتجاوز الفضاء الواحد (إحصائيات الجامعة، إنشاء الفضاءات والحسابات) يمرّ عبر service_role من إجراءات خادم
-- تتحقق من أن المستدعي مشرف عام، أو عبر دوال security definer تتحقق من الدور.
--
-- ميزات الخطة (cohorts.features) تُفرض هنا أيضاً: الدوال والسياسات ترفض الميزة المعطّلة (feature_disabled).
--
-- يُنفَّذ بعد 0017. آمن لإعادة التشغيل (idempotent). لا تُعد تشغيل 0002.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────── 1) الفضاءات والحسابات ─────────────────────────
drop policy if exists cohorts_read on public.cohorts;
create policy cohorts_read on public.cohorts for select to authenticated
  using (id = public.my_cohort() or public.is_admin());
-- cohorts_admin (كل شيء للمشرف العام) من 0001 كما هي

-- مشرف الفضاء يقرأ ملفات طلاب فضائه (إدارة الحسابات)؛ الطالب والمشرف العادي كما كانا (ملفه وحده)
drop policy if exists profiles_read_space on public.profiles;
create policy profiles_read_space on public.profiles for select to authenticated
  using (public.is_space_admin() and cohort_id = public.my_cohort());

-- ───────────────────────── 2) المحتوى الدراسي ─────────────────────────
-- الفصول
drop policy if exists semesters_read on public.semesters;
drop policy if exists semesters_admin on public.semesters;
create policy semesters_read on public.semesters for select to authenticated
  using (cohort_id = public.my_cohort());
create policy semesters_admin on public.semesters for all to authenticated
  using (public.is_manager() and cohort_id = public.my_cohort())
  with check (public.is_manager() and cohort_id = public.my_cohort());

-- المواد
drop policy if exists subjects_read on public.subjects;
drop policy if exists subjects_admin on public.subjects;
create policy subjects_read on public.subjects for select to authenticated
  using (cohort_id = public.my_cohort());
create policy subjects_admin on public.subjects for all to authenticated
  using (public.is_manager() and cohort_id = public.my_cohort())
  with check (public.is_manager() and cohort_id = public.my_cohort());

-- الحصص (الدروس)
drop policy if exists lessons_read on public.lessons;
drop policy if exists lessons_insert on public.lessons;
drop policy if exists lessons_update on public.lessons;
drop policy if exists lessons_delete on public.lessons;
create policy lessons_read on public.lessons for select to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (status = 'published' or public.is_staff()));
create policy lessons_insert on public.lessons for insert to authenticated
  with check (public.is_staff() and public.subject_cohort(subject_id) = public.my_cohort());
create policy lessons_update on public.lessons for update to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid()
              and (status <> 'published' or public.can_publish_direct()))))
  with check (public.is_staff() and public.subject_cohort(subject_id) = public.my_cohort());
create policy lessons_delete on public.lessons for delete to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid() and status <> 'published')));

-- ملفات الحصص
drop policy if exists lesson_files_read on public.lesson_files;
drop policy if exists lesson_files_insert on public.lesson_files;
drop policy if exists lesson_files_delete on public.lesson_files;
create policy lesson_files_read on public.lesson_files for select to authenticated
  using (public.lesson_cohort(lesson_id) = public.my_cohort()
         and (public.is_staff() or exists (
              select 1 from public.lessons l where l.id = lesson_id and l.status = 'published')));
create policy lesson_files_insert on public.lesson_files for insert to authenticated
  with check (public.is_staff() and public.lesson_cohort(lesson_id) = public.my_cohort());
create policy lesson_files_delete on public.lesson_files for delete to authenticated
  using (public.lesson_cohort(lesson_id) = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and exists (
              select 1 from public.lessons l where l.id = lesson_id and l.created_by = auth.uid()))));

-- مقاطع الدروس (RAG): للميزة «ai» فقط، ولفضاء المستخدم فقط
drop policy if exists chunks_read on public.lesson_chunks;
create policy chunks_read on public.lesson_chunks for select to authenticated
  using (public.lesson_cohort(lesson_id) = public.my_cohort()
         and public.my_feature('ai')
         and exists (select 1 from public.lessons l
                     where l.id = lesson_chunks.lesson_id and (l.status = 'published' or public.is_staff())));

-- الأسئلة (الصلاحية على الأعمدة من 0003 كما هي: لا قراءة لـ correct_index/explanation من المتصفح)
drop policy if exists questions_read on public.questions;
drop policy if exists questions_insert on public.questions;
drop policy if exists questions_update on public.questions;
drop policy if exists questions_delete on public.questions;
create policy questions_read on public.questions for select to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (status = 'published' or public.is_staff()));
create policy questions_insert on public.questions for insert to authenticated
  with check (public.is_staff() and public.subject_cohort(subject_id) = public.my_cohort()
              and (lesson_id is null or public.lesson_cohort(lesson_id) = public.my_cohort()));
create policy questions_update on public.questions for update to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid()
              and (status <> 'published' or public.can_publish_direct()))))
  with check (public.is_staff() and public.subject_cohort(subject_id) = public.my_cohort()
              and (lesson_id is null or public.lesson_cohort(lesson_id) = public.my_cohort()));
create policy questions_delete on public.questions for delete to authenticated
  using (public.subject_cohort(subject_id) = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid() and status <> 'published')));

-- التمارين المكتوبة تتطلب ميزة «written» في فضاء المادة (حتى لو أُرسلت مباشرة إلى الواجهة البرمجية)
create or replace function public.questions_plan_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.type = 'written' and (tg_op = 'INSERT' or old.type is distinct from 'written')
     and not public.cohort_feature(public.subject_cohort(new.subject_id), 'written') then
    raise exception 'feature_disabled';
  end if;
  return new;
end $$;
drop trigger if exists trg_questions_plan on public.questions;
create trigger trg_questions_plan before insert or update of type on public.questions
  for each row execute function public.questions_plan_guard();
revoke all on function public.questions_plan_guard() from public, anon;

-- ───────────────────────── 3) الجدول والإعلانات والتسجيلات ─────────────────────────
drop policy if exists schedule_read on public.schedule_sessions;
drop policy if exists schedule_write on public.schedule_sessions;
create policy schedule_read on public.schedule_sessions for select to authenticated
  using (cohort_id = public.my_cohort());
create policy schedule_write on public.schedule_sessions for all to authenticated
  using (public.is_staff() and cohort_id = public.my_cohort())
  with check (public.is_staff() and cohort_id = public.my_cohort()
              and public.subject_cohort(subject_id) = cohort_id);

drop policy if exists announcements_read on public.announcements;
drop policy if exists announcements_admin on public.announcements;
create policy announcements_read on public.announcements for select to authenticated
  using (cohort_id = public.my_cohort()
         and (public.is_staff() or expires_at is null or expires_at > now()));
create policy announcements_admin on public.announcements for all to authenticated
  using (public.is_manager() and cohort_id = public.my_cohort())
  with check (public.is_manager() and cohort_id = public.my_cohort());

-- التسجيلات: ميزة «recordings»
drop policy if exists recordings_read on public.recordings;
drop policy if exists recordings_insert on public.recordings;
drop policy if exists recordings_update on public.recordings;
drop policy if exists recordings_delete on public.recordings;
create policy recordings_read on public.recordings for select to authenticated
  using (cohort_id = public.my_cohort() and public.my_feature('recordings')
         and (public.is_staff() or status = 'published'));
create policy recordings_insert on public.recordings for insert to authenticated
  with check (public.is_staff() and cohort_id = public.my_cohort() and public.my_feature('recordings')
              and public.subject_cohort(subject_id) = cohort_id);
create policy recordings_update on public.recordings for update to authenticated
  using (cohort_id = public.my_cohort() and public.my_feature('recordings')
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid()
              and (status <> 'published' or public.can_publish_direct()))))
  with check (public.is_staff() and cohort_id = public.my_cohort()
              and public.subject_cohort(subject_id) = cohort_id);
create policy recordings_delete on public.recordings for delete to authenticated
  using (cohort_id = public.my_cohort()
         and (public.is_manager() or (public.is_staff() and created_by = auth.uid() and status <> 'published')));

drop policy if exists marks_read on public.recording_marks;
drop policy if exists marks_write on public.recording_marks;
create policy marks_read on public.recording_marks for select to authenticated
  using (exists (select 1 from public.recordings r
                 where r.id = recording_id and r.cohort_id = public.my_cohort() and public.my_feature('recordings')
                   and (public.is_staff() or r.status = 'published')));
create policy marks_write on public.recording_marks for all to authenticated
  using (public.is_staff() and exists (select 1 from public.recordings r where r.id = recording_id and r.cohort_id = public.my_cohort()))
  with check (public.is_staff() and exists (select 1 from public.recordings r where r.id = recording_id and r.cohort_id = public.my_cohort()));

-- ───────────────────────── 4) المساعد الذكي: ميزة «ai» ─────────────────────────
drop policy if exists conv_own on public.conversations;
create policy conv_own on public.conversations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.my_feature('ai'));

drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert to authenticated
  with check (user_id = auth.uid() and public.my_feature('ai')
              and exists (select 1 from public.conversations c where c.id = conversation_id and c.user_id = auth.uid()));

drop policy if exists analysis_write on public.student_analysis;
create policy analysis_write on public.student_analysis for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.my_feature('ai'));

-- ───────────────────────── 5) تخزين ملفات الحصص ─────────────────────────
-- مسار الملف: <lesson_id>/<اسم>. فضاء الملف = فضاء الحصة التي في اسم المجلد (يُحسب في الدالة أدناه، وتعيد null لأي مسار آخر).
-- القراءة لمن في فضاء الحصة فقط (الطالب: ملفات مسجّلة لحصة منشورة؛ الطاقم: ما في فضائه ولو لم يُسجَّل بعد،
-- لأن رفع Storage يقرأ الصف بعد إدراجه)؛ الرفع لطاقم فضاء الحصة فقط.
create or replace function public.storage_path_cohort(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when position('/' in p_name) > 1
         and split_part(p_name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.lesson_cohort(split_part(p_name, '/', 1)::uuid)
  end
$$;
revoke all on function public.storage_path_cohort(text) from public, anon;
grant execute on function public.storage_path_cohort(text) to authenticated, service_role;

drop policy if exists lesson_files_storage_read on storage.objects;
drop policy if exists lesson_files_storage_insert on storage.objects;
drop policy if exists lesson_files_storage_delete on storage.objects;

create policy lesson_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files'
         and public.storage_path_cohort(name) = public.my_cohort()
         and (public.is_staff() or exists (
              select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
              where f.storage_path = storage.objects.name and l.status = 'published')));

create policy lesson_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-files' and public.is_staff()
              and public.storage_path_cohort(name) = public.my_cohort());

create policy lesson_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-files' and public.is_staff()
         and public.storage_path_cohort(name) = public.my_cohort()
         and (public.is_manager() or owner = auth.uid()));

-- ───────────────────────── 6) دوال التدريب: الفضاء + الميزات ─────────────────────────
-- start_attempt: الأسئلة من مواد فضاء الطالب فقط (الدالة security definer فلا يحميها RLS، فالحصر صريح هنا).
--   ranked ← ميزة arena. review ← ميزة review. المكتوب ← ميزة written (وإلا يُفرض QCM).
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
  coh uuid := public.my_cohort();
  ids uuid[];
  n integer;
  limit_s integer;
  new_id uuid;
  existing record;
  c_ranked constant integer := 20;
  min_ranked constant integer := 5;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if coh is null then raise exception 'no_space'; end if;
  if p_mode not in ('free', 'ranked', 'review') then raise exception 'bad_mode'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then p_difficulty := null; end if;
  if p_type not in ('mcq', 'written', 'mixed') then p_type := 'mixed'; end if;
  if p_mode = 'ranked' and not public.my_feature('arena') then raise exception 'feature_disabled'; end if;
  if p_mode = 'review' and not public.my_feature('review') then raise exception 'feature_disabled'; end if;
  if not public.my_feature('written') then p_type := 'mcq'; end if;

  if p_mode = 'ranked' then
    -- أنهِ المحاولات المصنّفة المنتهية الوقت، وأعد الجارية
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
        join public.subjects sj on sj.id = q.subject_id and sj.cohort_id = coh
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
      join public.subjects sj on sj.id = q.subject_id and sj.cohort_id = coh
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
        join public.subjects sj on sj.id = q.subject_id and sj.cohort_id = coh
        left join public.lessons l on l.id = q.lesson_id
        where q.status = 'published'
          and not q.exam_only -- مخصّصة للاختبار المصنّف فقط: لا تظهر في التدريب الحر
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
  values (uid, coh, p_mode, case when p_mode = 'review' then null else p_subject end,
          p_lesson, ids, limit_s, n)
  returning id into new_id;
  return new_id;
end $$;

-- الترتيب: ميزة ranking، وضمن فضاء الطالب وفصله الحالي
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
  if uid is null or coh is null or not public.my_feature('ranking') then return; end if;
  if p_scope = 'week' then
    since := date_trunc('week', now() at time zone p_tz) at time zone p_tz;
  else
    select s.id into sem from public.semesters s where s.cohort_id = coh and s.is_current limit 1;
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

-- Duel: ميزة duel، ومادة من فضاء اللاعب
create or replace function public.create_duel(
  p_opponent uuid, p_subject uuid, p_lessons uuid[] default '{}', p_count integer default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  new_id uuid;
  n integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.my_feature('duel') then raise exception 'feature_disabled'; end if;
  perform public.duel_sweep();
  if p_opponent is null or p_opponent = uid then raise exception 'bad_opponent'; end if;
  if public.my_cohort() is null
     or not exists (select 1 from public.profiles where id = p_opponent and cohort_id = public.my_cohort())
  then raise exception 'bad_opponent'; end if;
  if p_subject is null or public.subject_cohort(p_subject) is distinct from public.my_cohort() then raise exception 'bad_subject'; end if;
  p_lessons := coalesce(p_lessons, '{}');
  p_count := least(greatest(coalesce(p_count, 8), 5), 15);

  -- حماية من الإزعاج: تحدٍّ واحد جارٍ مع كل زميل، و10 تحديات جديدة كحد أقصى في اليوم
  if exists (select 1 from public.duels d
             where d.status in ('challenger_turn', 'open')
               and ((d.challenger_id = uid and d.opponent_id = p_opponent)
                 or (d.challenger_id = p_opponent and d.opponent_id = uid)))
  then raise exception 'duel_exists'; end if;
  if (select count(*) from public.duels where challenger_id = uid and created_at > now() - interval '1 day') >= 10
  then raise exception 'too_many'; end if;

  select coalesce(array_agg(id), '{}') into ids from (
    select q.id from public.questions q
    where q.status = 'published' and q.type = 'mcq' and q.subject_id = p_subject
      and (cardinality(p_lessons) = 0 or q.lesson_id = any (p_lessons))
    order by random() limit p_count
  ) pick;
  n := coalesce(cardinality(ids), 0);
  if n < 5 then raise exception 'not_enough_questions'; end if;

  insert into public.duels (cohort_id, challenger_id, opponent_id, subject_id, lesson_ids, question_ids)
  values (public.my_cohort(), uid, p_opponent, p_subject, p_lessons, ids)
  returning id into new_id;
  insert into public.duel_players (duel_id, user_id) values (new_id, uid), (new_id, p_opponent);
  return new_id;
end $$;

create or replace function public.cohort_mates() returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
  where p.cohort_id = public.my_cohort() and p.id <> auth.uid() and p.role = 'student'
    and public.my_feature('duel')
  order by p.full_name
$$;

create or replace function public.duel_record() returns table(user_id uuid, full_name text, wins integer, losses integer, draws integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.my_feature('duel') then return; end if;
  return query
  select p.id, p.full_name,
         count(d.id) filter (where d.winner_id = p.id)::integer,
         count(d.id) filter (where d.winner_id is not null and d.winner_id <> p.id)::integer,
         count(d.id) filter (where d.is_draw)::integer,
         p.id = uid
  from public.profiles p
  left join public.duels d
    on d.status in ('completed', 'expired') and p.id in (d.challenger_id, d.opponent_id)
  where p.cohort_id = public.my_cohort() and (p.id = uid or not p.hide_from_ranking or public.is_admin())
  group by p.id, p.full_name
  order by 3 desc, 4 asc, p.full_name;
end $$;

-- ───────────────────────── 7) QCM PDF: ميزة qcm_pdf + حصر الفضاء ─────────────────────────
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
  coh uuid := public.my_cohort();
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
  if coh is null then raise exception 'no_space'; end if;
  if not public.my_feature('qcm_pdf') then raise exception 'feature_disabled'; end if;
  if p_difficulty is not null and p_difficulty not in ('easy', 'medium', 'hard') then p_difficulty := null; end if;
  lim := least(greatest(coalesce(p_count, 20), 1), 50);

  -- يمنع سباقاً بين طلبين متزامنين لنفس الطالب
  perform pg_advisory_xact_lock(hashtext('qcm_export:' || uid::text));
  select count(*) into used from public.qcm_downloads
    where user_id = uid and created_at > now() - interval '24 hours';
  if used >= c_daily_limit then raise exception 'download_limit'; end if;

  if p_lesson is not null then
    select l.kind, l.number, l.title, l.subject_id into l_kind, l_number, l_title, subj
      from public.lessons l where l.id = p_lesson and public.lesson_cohort(l.id) = coh;
    if not found then subj := p_subject; p_lesson := null; end if;
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
      join public.subjects sj on sj.id = q.subject_id and sj.cohort_id = coh
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

-- ───────────────────────── 8) الذكاء الاصطناعي: ميزة ai ─────────────────────────
create or replace function public.ai_take(
  p_kind text, p_window_limit integer, p_window_seconds integer, p_day_limit integer
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n_window integer;
  n_day integer;
begin
  if uid is null or not public.my_feature('ai') then return false; end if;
  delete from public.ai_usage where user_id = uid and at < now() - interval '35 days';
  select count(*) into n_window from public.ai_usage
    where user_id = uid and kind = p_kind and at > now() - make_interval(secs => p_window_seconds);
  select count(*) into n_day from public.ai_usage
    where user_id = uid and kind = p_kind and at > now() - interval '1 day';
  if n_window >= p_window_limit or n_day >= p_day_limit then return false; end if;
  insert into public.ai_usage (user_id, kind) values (uid, p_kind);
  return true;
end $$;

create or replace function public.my_stats(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := coalesce(p_user, auth.uid());
  res jsonb;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if not public.my_feature('ai') then raise exception 'feature_disabled'; end if;
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

-- ───────────────────────── 9) إحصائيات الفضاء (مدير الفضاء) ─────────────────────────
-- كانت للمشرف العام على كل الدفعة؛ تصبح لمدير الفضاء الحالي (مشرف الفضاء أو المشرف العام داخله) على فضائه فقط.
create or replace function public.admin_students() returns table(
  id uuid, full_name text, last_seen_at timestamptz, answers_7d integer, attempts_total integer,
  accuracy numeric, lessons_studied integer, duels_played integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  return query
  select p.id, p.full_name, p.last_seen_at,
    (select count(*)::integer from public.attempt_answers a where a.user_id = p.id and a.answered_at > now() - interval '7 days'),
    (select count(*)::integer from public.attempts t where t.user_id = p.id),
    (select round(100.0 * count(*) filter (where a.is_correct) / nullif(count(*), 0), 1) from public.attempt_answers a where a.user_id = p.id),
    (select count(*)::integer from public.lesson_progress lp where lp.user_id = p.id),
    (select count(*)::integer from public.duel_players dp join public.duels d on d.id = dp.duel_id
       where dp.user_id = p.id and d.status in ('completed', 'expired'))
  from public.profiles p
  where p.role = 'student' and p.cohort_id = public.my_cohort()
  order by p.last_seen_at desc nulls last, p.full_name;
end $$;

create or replace function public.admin_subject_stats() returns table(
  subject_id uuid, code text, name text, students integer, answers integer, accuracy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  return query
  select s.id, s.code, s.name,
    count(distinct a.user_id)::integer, count(a.id)::integer,
    round(100.0 * count(a.id) filter (where a.is_correct) / nullif(count(a.id), 0), 1)
  from public.subjects s
  join public.semesters sem on sem.id = s.semester_id and sem.is_current
  left join public.attempt_answers a on a.subject_id = s.id and a.qtype = 'mcq'
  where s.cohort_id = public.my_cohort()
  group by s.id, s.code, s.name, s.sort
  order by s.sort;
end $$;

create or replace function public.admin_weak_lessons(p_limit integer default 12) returns table(
  lesson_id uuid, kind text, number integer, title text, subject_code text,
  students integer, weak_students integer, accuracy numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  return query
  with per as (
    select q.lesson_id as lid, a.user_id,
           count(*) as n, count(*) filter (where a.is_correct) as c
    from public.attempt_answers a
    join public.questions q on q.id = a.question_id
    join public.profiles p on p.id = a.user_id and p.role = 'student' and p.cohort_id = public.my_cohort()
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

-- ───────────────────────── 10) تذكير المراجعة (الخادم فقط): للفضاءات التي فيها ميزة review ─────────────────────────
create or replace function public.review_reminder_targets() returns table(user_id uuid, due integer)
language sql stable security definer set search_path = public as $$
  select r.user_id, count(*)::integer
  from public.review_queue r
  join public.questions q on q.id = r.question_id and q.status = 'published'
  join public.profiles p on p.id = r.user_id
  join public.cohorts c on c.id = p.cohort_id and c.is_active
  where not r.mastered and r.due_at <= now()
    and coalesce((c.features ->> 'review')::boolean, false)
  group by r.user_id
$$;
