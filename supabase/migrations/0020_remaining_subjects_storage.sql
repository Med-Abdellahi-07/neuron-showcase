-- ══════════════════════════════════════════════════════════════════════════
-- 0020 — المواد المتبقية من L1 + حد حجم PDF + استهلاك التخزين
-- بعد 0019. آمن لإعادة التشغيل. لا يمس أي بيانات موجودة.
-- ══════════════════════════════════════════════════════════════════════════

-- ───────── 1) جدول المواد المتبقية ─────────
create table if not exists public.remaining_subjects (
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (student_id, subject_id)
);
create index if not exists remaining_subjects_subject_idx on public.remaining_subjects(subject_id);

-- فضاء طالب (security definer كي لا تتعثر السياسات بـ RLS على profiles)
create or replace function public.profile_cohort(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select cohort_id from public.profiles where id = p_user
$$;

-- هل الطالب الحالي يتابع هذه المادة (متبقية من L1)؟
create or replace function public.follows_subject(p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.remaining_subjects r where r.student_id = auth.uid() and r.subject_id = p_subject)
$$;

-- القيود في قاعدة البيانات (تسري على أي مصدر، حتى service role):
--   الطالب طالب فعلاً في فضاء L2، والمادة من فضاء L1 لنفس التخصص. لا L1→L2 ولا تخصص آخر.
create or replace function public.remaining_subjects_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s_role text; s_coh uuid; s_major uuid; s_level text;
  m_coh uuid; m_major uuid; m_level text;
begin
  select p.role, p.cohort_id into s_role, s_coh from public.profiles p where p.id = new.student_id;
  if s_role is distinct from 'student' then raise exception 'not_a_student'; end if;
  select c.major_id, c.level_code into s_major, s_level from public.cohorts c where c.id = s_coh;
  if s_level is distinct from 'L2' then raise exception 'student_not_l2'; end if;
  select sj.cohort_id into m_coh from public.subjects sj where sj.id = new.subject_id;
  select c.major_id, c.level_code into m_major, m_level from public.cohorts c where c.id = m_coh;
  if m_level is distinct from 'L1' or m_major is null or m_major is distinct from s_major then
    raise exception 'subject_not_same_major_l1';
  end if;
  return new;
end $$;
drop trigger if exists remaining_subjects_guard_trg on public.remaining_subjects;
create trigger remaining_subjects_guard_trg before insert or update on public.remaining_subjects
  for each row execute function public.remaining_subjects_guard();

-- انتقال الطالب إلى فضاء/تخصص آخر ← تسقط مواده المتبقية (لم تعد صالحة)
create or replace function public.profiles_clear_remaining() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.cohort_id is distinct from old.cohort_id then
    delete from public.remaining_subjects where student_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_clear_remaining_trg on public.profiles;
create trigger profiles_clear_remaining_trg after update of cohort_id on public.profiles
  for each row execute function public.profiles_clear_remaining();

alter table public.remaining_subjects enable row level security;
revoke all on public.remaining_subjects from anon;
revoke update on public.remaining_subjects from authenticated;
grant select, insert, delete on public.remaining_subjects to authenticated;
grant all on public.remaining_subjects to service_role;

drop policy if exists remaining_read on public.remaining_subjects;
drop policy if exists remaining_insert on public.remaining_subjects;
drop policy if exists remaining_delete on public.remaining_subjects;
-- الطالب يقرأ مواده؛ مدير فضاء الطالب (L2) يقرأ ويضيف ويزيل. مدير L1 لا يصل للجدول (له l1_followers أدناه).
create policy remaining_read on public.remaining_subjects for select to authenticated
  using (student_id = auth.uid() or (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort()));
create policy remaining_insert on public.remaining_subjects for insert to authenticated
  with check (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort());
create policy remaining_delete on public.remaining_subjects for delete to authenticated
  using (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort());

-- مشرف L1: قائمة (قراءة فقط) بطلاب L2 الذين يتابعون مواد فضائه. أسماء فقط، بلا بريد/هاتف.
create or replace function public.l1_followers() returns table(
  student_name text, student_space text, subject_code text, subject_name text, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  return query
  select p.full_name, c.name, sj.code, sj.name, r.created_at
  from public.remaining_subjects r
  join public.subjects sj on sj.id = r.subject_id and sj.cohort_id = public.my_cohort()
  join public.profiles p on p.id = r.student_id
  left join public.cohorts c on c.id = p.cohort_id
  order by sj.code, p.full_name;
end $$;
revoke all on function public.l1_followers() from public, anon;
grant execute on function public.l1_followers() to authenticated, service_role;
revoke all on function public.profile_cohort(uuid), public.follows_subject(uuid) from public, anon;
grant execute on function public.profile_cohort(uuid), public.follows_subject(uuid) to authenticated, service_role;

-- ───────── 2) قراءة محتوى المواد المتبقية (القراءة فقط، المنشور فقط) ─────────
drop policy if exists subjects_read on public.subjects;
create policy subjects_read on public.subjects for select to authenticated
  using (cohort_id = public.my_cohort() or public.follows_subject(id));

drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons for select to authenticated
  using ((public.subject_cohort(subject_id) = public.my_cohort() and (status = 'published' or public.is_staff()))
         or (status = 'published' and public.follows_subject(subject_id)));

drop policy if exists lesson_files_read on public.lesson_files;
create policy lesson_files_read on public.lesson_files for select to authenticated
  using ((public.lesson_cohort(lesson_id) = public.my_cohort()
          and (public.is_staff() or exists (select 1 from public.lessons l where l.id = lesson_id and l.status = 'published')))
         or exists (select 1 from public.lessons l
                    where l.id = lesson_id and l.status = 'published' and public.follows_subject(l.subject_id)));

-- الأسئلة: المتبقية تظهر QCM فقط ما لم تكن خطة فضاء L1 تتيح المكتوب (ميزات الفضاء الأصلي للمادة)
drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to authenticated
  using ((public.subject_cohort(subject_id) = public.my_cohort() and (status = 'published' or public.is_staff()))
         or (status = 'published' and public.follows_subject(subject_id)
             and (type = 'mcq' or public.cohort_feature(public.subject_cohort(subject_id), 'written'))));

drop policy if exists schedule_read on public.schedule_sessions;
create policy schedule_read on public.schedule_sessions for select to authenticated
  using (cohort_id = public.my_cohort() or public.follows_subject(subject_id));

drop policy if exists lesson_files_storage_read on storage.objects;
create policy lesson_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files'
         and ((public.storage_path_cohort(name) = public.my_cohort()
               and (public.is_staff() or exists (
                    select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
                    where f.storage_path = storage.objects.name and l.status = 'published')))
              or exists (
                    select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
                    where f.storage_path = storage.objects.name and l.status = 'published'
                      and public.follows_subject(l.subject_id))));

-- ───────── 3) التدريب: أسئلة QCM الحرة للمواد المتبقية أيضاً ─────────
-- نفس start_attempt الحالية (0018) مع تعديل واحد في فرع «free»: المادة من فضائي أو متبقية (QCM فقط).
-- المصنّف والمراجعة يبقيان على مواد فضائي وحده.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
    where p.proname = 'start_attempt' and p.pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'start_attempt missing: run 0018 first'; end if;
  if def like '%follows_subject%' then return; end if; -- مُطبَّق من قبل
  def := replace(def,
    E'        from public.questions q\n        join public.subjects sj on sj.id = q.subject_id and sj.cohort_id = coh\n        left join public.lessons l on l.id = q.lesson_id',
    E'        from public.questions q\n        join public.subjects sj on sj.id = q.subject_id\n          and (sj.cohort_id = coh or (public.follows_subject(sj.id) and q.type = ''mcq''))\n        left join public.lessons l on l.id = q.lesson_id');
  if def not like '%follows_subject%' then raise exception 'start_attempt patch did not apply'; end if;
  execute def;
end $$;

-- ───────── 4) التخزين: حد حجم PDF واستهلاك التخزين ─────────
-- 15MB كحد أقصى لأي ملف حصة (PDF وغيره): في الجدول (يرفض أي مصدر) وفي دلو التخزين نفسه.
create or replace function public.lesson_files_size_guard() returns trigger
language plpgsql as $$
begin
  if coalesce(new.size_bytes, 0) > 15728640 then raise exception 'file_too_large'; end if;
  return new;
end $$;
drop trigger if exists lesson_files_size_guard_trg on public.lesson_files;
create trigger lesson_files_size_guard_trg before insert on public.lesson_files
  for each row execute function public.lesson_files_size_guard();

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 15728640 where id = 'lesson-files';
  end if;
end $$;

-- استهلاك التخزين الكلي ولكل فضاء (مجموع أحجام ملفات الحصص المسجّلة). للمشرف العام فقط.
create or replace function public.storage_usage() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'total_bytes', coalesce((select sum(coalesce(f.size_bytes, 0)) from public.lesson_files f), 0),
    'files', (select count(*) from public.lesson_files),
    'by_space', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'bytes', x.bytes, 'files', x.files) order by x.bytes desc)
      from (select c.id, c.name, coalesce(sum(coalesce(f.size_bytes, 0)), 0) as bytes, count(f.id) as files
            from public.cohorts c
            left join public.subjects sj on sj.cohort_id = c.id
            left join public.lessons l on l.subject_id = sj.id
            left join public.lesson_files f on f.lesson_id = l.id
            group by c.id, c.name) x
      where x.files > 0), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.storage_usage() from public, anon;
grant execute on function public.storage_usage() to authenticated, service_role;
