-- ══════════════════════════════════════════════════════════════════════════
-- 0020 - remaining L1 subjects + PDF size limit + storage usage
-- After 0019. Safe to re-run. Touches no existing data.
-- ══════════════════════════════════════════════════════════════════════════

-- ───────── 1) Remaining subjects table ─────────
create table if not exists public.remaining_subjects (
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (student_id, subject_id)
);
create index if not exists remaining_subjects_subject_idx on public.remaining_subjects(subject_id);

-- A student's space (security definer so policies are not tripped up by RLS on profiles)
create or replace function public.profile_cohort(p_user uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select cohort_id from public.profiles where id = p_user
$$;

-- Does the current student follow this subject (remaining from L1)?
create or replace function public.follows_subject(p_subject uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.remaining_subjects r where r.student_id = auth.uid() and r.subject_id = p_subject)
$$;

-- Database constraints (apply to any source, even the service role):
--   The student is actually in an L2 space, and the subject belongs to an L1 space of the same major. No L1->L2 only, no other major.
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

-- A student who moves to another space/major loses their remaining subjects (they are no longer valid)
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
-- A student reads their own subjects; the manager of the student's (L2) space reads, adds and removes. An L1 manager cannot reach the table (they have l1_followers below).
create policy remaining_read on public.remaining_subjects for select to authenticated
  using (student_id = auth.uid() or (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort()));
create policy remaining_insert on public.remaining_subjects for insert to authenticated
  with check (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort());
create policy remaining_delete on public.remaining_subjects for delete to authenticated
  using (public.is_manager() and public.profile_cohort(student_id) = public.my_cohort());

-- L1 moderator: a read-only list of the L2 students who follow their space's subjects. Names only, no email/phone.
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

-- ───────── 2) Reading remaining-subject content (read-only, published only) ─────────
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

-- Questions: remaining subjects show QCM only unless the L1 space's plan allows written (the subject's original space features)
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

-- ───────── 3) Practice: free QCM questions for remaining subjects too ─────────
-- Same current start_attempt (0018) with one change in the "free" branch: the subject is from my space or a remaining one (QCM only).
-- Ranked and review stay on my own space's subjects only.
do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
    where p.proname = 'start_attempt' and p.pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'start_attempt missing: run 0018 first'; end if;
  if def like '%follows_subject%' then return; end if; -- already applied
  -- A regular expression tolerant of whitespace/line-ending differences (the stored text may differ from the file)
  def := regexp_replace(def,
    $q$join\s+public\.subjects\s+sj\s+on\s+sj\.id\s*=\s*q\.subject_id\s+and\s+sj\.cohort_id\s*=\s*coh(\s+left\s+join\s+public\.lessons\s+l\s+on\s+l\.id\s*=\s*q\.lesson_id)$q$,
    $q$join public.subjects sj on sj.id = q.subject_id and (sj.cohort_id = coh or (public.follows_subject(sj.id) and q.type = 'mcq'))\1$q$);
  if def not like '%follows_subject%' then raise exception 'start_attempt patch did not apply'; end if;
  execute def;
end $$;

-- ───────── 4) Storage: PDF size limit and storage usage ─────────
-- 15MB maximum for any lesson file (PDF or other): in the table (rejects any source) and in the storage bucket itself.
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

-- Total storage usage and per space (sum of registered lesson file sizes). Super admin only.
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
