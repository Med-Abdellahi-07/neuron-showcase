-- Neuron - phase 1 (core)
-- Run once from Supabase -> SQL Editor.

-- ───────────────────────── Cohorts and users ─────────────────────────
create table if not exists public.cohorts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  phone text unique,
  role text not null default 'student' check (role in ('student', 'moderator', 'admin')),
  can_publish_direct boolean not null default false,
  cohort_id uuid references public.cohorts(id) on delete set null,
  locale text not null default 'ar' check (locale in ('ar', 'fr')),
  english_group text,
  hide_from_ranking boolean not null default false,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Permission helper functions ─────────────────────────
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('moderator', 'admin') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.can_publish_direct() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' or can_publish_direct from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.my_cohort() returns uuid
language sql stable security definer set search_path = public as $$
  select cohort_id from public.profiles where id = auth.uid()
$$;

-- Prevent students/moderators from changing their own role, cohort or permissions (the service role is exempt: auth.uid() is null)
create or replace function public.protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role
       or new.cohort_id is distinct from old.cohort_id
       or new.can_publish_direct is distinct from old.can_publish_direct
       or new.phone is distinct from old.phone
       or new.email is distinct from old.email then
      raise exception 'غير مسموح بتعديل هذه الحقول';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_protect_profile_fields on public.profiles;
create trigger trg_protect_profile_fields before update on public.profiles
  for each row execute function public.protect_profile_fields();

-- ───────────────────────── Curriculum (shared across cohorts) ─────────────────────────
create table if not exists public.semesters (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  is_current boolean not null default false
);

create table if not exists public.subjects (
  id uuid primary key default gen_random_uuid(),
  semester_id uuid not null references public.semesters(id) on delete cascade,
  code text not null unique,
  name text not null,
  credits int not null default 0,
  cm_hours int not null default 0,
  td_hours int not null default 0,
  tp_hours int not null default 0,
  sort int not null default 0
);

create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in ('cm', 'td', 'tp', 'resume')),
  number int not null check (number > 0),
  title text not null,
  lesson_date date,
  status text not null default 'draft' check (status in ('draft', 'pending', 'published')),
  colab_url text,
  drive_url text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (subject_id, kind, number)
);
create index if not exists lessons_subject_idx on public.lessons(subject_id, kind, number);

create table if not exists public.lesson_files (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  kind text not null check (kind in ('pdf', 'code', 'data')),
  name text not null,
  storage_path text not null unique,
  size_bytes bigint,
  created_at timestamptz not null default now()
);
create index if not exists lesson_files_lesson_idx on public.lesson_files(lesson_id);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  lesson_id uuid references public.lessons(id) on delete set null,
  type text not null check (type in ('mcq', 'written')),
  difficulty text not null default 'medium' check (difficulty in ('easy', 'medium', 'hard')),
  statement text not null,
  options jsonb,
  correct_index smallint,
  model_answer text,
  explanation text,
  status text not null default 'draft' check (status in ('draft', 'pending', 'published')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  constraint mcq_shape check (
    type <> 'mcq' or (
      jsonb_typeof(options) = 'array'
      and jsonb_array_length(options) >= 2
      and correct_index is not null
      and correct_index >= 0
      and correct_index < jsonb_array_length(options)
    )
  ),
  constraint written_shape check (type <> 'written' or model_answer is not null)
);
create index if not exists questions_filter_idx on public.questions(subject_id, lesson_id, difficulty);

-- Publishing rule: a moderator without the "publish directly" permission has their posts set to "pending approval"
create or replace function public.enforce_publish_rule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and new.status = 'published' and not public.can_publish_direct() then
    if tg_op = 'INSERT' or old.status is distinct from 'published' then
      new.status := 'pending';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_lessons_publish on public.lessons;
create trigger trg_lessons_publish before insert or update on public.lessons
  for each row execute function public.enforce_publish_rule();

drop trigger if exists trg_questions_publish on public.questions;
create trigger trg_questions_publish before insert or update on public.questions
  for each row execute function public.enforce_publish_rule();

-- ───────────────────────── Cohort-specific data ─────────────────────────
create table if not exists public.schedule_sessions (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  session_date date not null,
  slot smallint not null check (slot between 1 and 6),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in ('cm', 'td', 'tp')),
  room text,
  teacher text,
  shared_with text,
  group_label text,
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled', 'changed')),
  note text,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists schedule_week_idx on public.schedule_sessions(cohort_id, session_date);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists announcements_idx on public.announcements(cohort_id, created_at desc);

-- ───────────────────────── Student-specific data ─────────────────────────
create table if not exists public.lesson_progress (
  user_id uuid not null references public.profiles(id) on delete cascade default auth.uid(),
  lesson_id uuid not null references public.lessons(id) on delete cascade,
  studied_at timestamptz not null default now(),
  primary key (user_id, lesson_id)
);

-- ───────────────────────── Row Level Security ─────────────────────────
alter table public.cohorts enable row level security;
alter table public.profiles enable row level security;
alter table public.semesters enable row level security;
alter table public.subjects enable row level security;
alter table public.lessons enable row level security;
alter table public.lesson_files enable row level security;
alter table public.questions enable row level security;
alter table public.schedule_sessions enable row level security;
alter table public.announcements enable row level security;
alter table public.lesson_progress enable row level security;

-- cohorts
create policy cohorts_read on public.cohorts for select to authenticated
  using (id = public.my_cohort() or public.is_staff());
create policy cohorts_admin on public.cohorts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- profiles
create policy profiles_read_own on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy profiles_admin_write on public.profiles for insert to authenticated
  with check (public.is_admin());
create policy profiles_admin_delete on public.profiles for delete to authenticated
  using (public.is_admin());

-- semesters / subjects: readable by everyone, writable by the admin
create policy semesters_read on public.semesters for select to authenticated using (true);
create policy semesters_admin on public.semesters for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy subjects_read on public.subjects for select to authenticated using (true);
create policy subjects_admin on public.subjects for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- lessons
create policy lessons_read on public.lessons for select to authenticated
  using (status = 'published' or public.is_staff());
create policy lessons_insert on public.lessons for insert to authenticated
  with check (public.is_staff());
create policy lessons_update on public.lessons for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()
         and (status <> 'published' or public.can_publish_direct())))
  with check (public.is_staff());
create policy lessons_delete on public.lessons for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'published'));

-- lesson_files
create policy lesson_files_read on public.lesson_files for select to authenticated
  using (public.is_staff() or exists (
    select 1 from public.lessons l where l.id = lesson_id and l.status = 'published'));
create policy lesson_files_insert on public.lesson_files for insert to authenticated
  with check (public.is_staff());
create policy lesson_files_delete on public.lesson_files for delete to authenticated
  using (public.is_admin() or (public.is_staff() and exists (
    select 1 from public.lessons l where l.id = lesson_id and l.created_by = auth.uid())));

-- questions
create policy questions_read on public.questions for select to authenticated
  using (status = 'published' or public.is_staff());
create policy questions_insert on public.questions for insert to authenticated
  with check (public.is_staff());
create policy questions_update on public.questions for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()
         and (status <> 'published' or public.can_publish_direct())))
  with check (public.is_staff());
create policy questions_delete on public.questions for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'published'));

-- schedule_sessions
create policy schedule_read on public.schedule_sessions for select to authenticated
  using (cohort_id = public.my_cohort() or public.is_staff());
create policy schedule_write on public.schedule_sessions for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- announcements
create policy announcements_read on public.announcements for select to authenticated
  using (cohort_id = public.my_cohort() or public.is_staff());
create policy announcements_admin on public.announcements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- lesson_progress: each student sees and edits only their own data
create policy progress_own on public.lesson_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ───────────────────────── Storage (session files) ─────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('lesson-files', 'lesson-files', false, 52428800)
on conflict (id) do nothing;

create policy lesson_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files' and (
    public.is_staff() or exists (
      select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
      where f.storage_path = storage.objects.name and l.status = 'published')));
create policy lesson_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'lesson-files' and public.is_staff());
create policy lesson_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'lesson-files' and (public.is_admin() or owner = auth.uid()));

-- ───────────────────────── Seed data ─────────────────────────
insert into public.cohorts (name) values ('Promo IA 2026') on conflict (name) do nothing;

insert into public.semesters (code, name, is_current) values
  ('S3', 'Semestre 3', true),
  ('S4', 'Semestre 4', false)
on conflict (code) do nothing;

insert into public.subjects (semester_id, code, name, credits, cm_hours, td_hours, tp_hours, sort)
select s.id, v.code, v.name, v.credits, v.cm, v.td, v.tp, v.sort
from public.semesters s
join (values
  ('LIAA311', 'Machine Learning II', 3, 15, 9, 12, 1),
  ('LIAA312', 'Analyse et visualisation de données', 3, 12, 9, 15, 2),
  ('LIAA313', 'Programmation R pour l''analyse de données', 3, 12, 9, 15, 3),
  ('LIAA321', 'Méthodes de gestion de projet (Agile, Scrum)', 2, 9, 6, 9, 4),
  ('LIAA322', 'Génie logiciel (BA : Business Analysis)', 2, 9, 6, 9, 5),
  ('LIAA331', 'Systèmes multi-agents', 3, 12, 12, 12, 6),
  ('LIAA332', 'Planification et prise de décision', 2, 9, 6, 9, 7),
  ('LIAA333', 'Logique et systèmes experts', 2, 9, 6, 9, 8),
  ('LTR343', 'Projet Professionnel et Personnel (PPP)', 4, 12, 12, 24, 9),
  ('LTR341', 'Anglais 3', 4, 0, 24, 24, 10),
  ('LTR342', 'Techniques de communication 3 (TC 3)', 2, 6, 18, 0, 11)
) as v(code, name, credits, cm, td, tp, sort) on s.code = 'S3'
on conflict (code) do nothing;
