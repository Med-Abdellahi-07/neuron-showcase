-- ════════════════════════════════════════════════════════════════════════════
-- 0017 - Spaces (University of Nouadhibou): institutions -> majors -> levels, and each "major x level" = an independent space
--
-- Idea: a space = a row in the existing cohorts table (extended with major, level and plan). So all tables
-- tied to cohort_id (timetable, announcements, recordings, Duel, ranking...) keep working as is, and each becomes private to its space.
-- Content that used to be shared (semesters/subjects and, through them, lessons/questions...) is tied to the space through cohort_id.
--
-- This file is "structure and data" only: it does not change RLS policies (those come in 0018). Idempotent.
-- The existing cohort (with all its students and content) becomes the "IAA L2" space without moving any row or losing any data.
-- Run after 0016 and before 0018. Never re-run 0002.
-- ════════════════════════════════════════════════════════════════════════════

-- ───────────────────────── 1) Levels, institutions, majors and plans ─────────────────────────
-- A level is a table row (not a value written in code): adding L3 later = insert a row, then call ensure_spaces().
create table if not exists public.levels (
  code text primary key check (code ~ '^L[1-9][0-9]*$'),
  sort smallint not null,
  semesters text[] not null check (cardinality(semesters) >= 1) -- semester codes of the level; the first one is the current one by default
);
insert into public.levels (code, sort, semesters) values
  ('L1', 1, array['S1', 'S2']),
  ('L2', 2, array['S3', 'S4'])
on conflict (code) do nothing;

create table if not exists public.institutions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_ar text not null,
  name_fr text not null,
  name_en text not null,
  sort smallint not null default 0
);

create table if not exists public.majors (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete cascade,
  code text not null unique,
  name_ar text not null,
  name_fr text not null,
  name_en text not null,
  sort smallint not null default 0
);
create index if not exists majors_institution_idx on public.majors(institution_id, sort);

-- The Arabic names are official; the French and English ones are provisional translations the super admin can edit from their panel.
-- on conflict do nothing: the super admin's edits are not overwritten when this is re-run.
insert into public.institutions (code, name_ar, name_fr, name_en, sort) values
  ('FST',  'كلية العلوم والتكنولوجيا',               'Faculté des Sciences et Techniques',               'Faculty of Science and Technology', 1),
  ('ISB',  'المعهد العالي للتكنولوجيا الحيوية',       'Institut Supérieur de Biotechnologie',             'Higher Institute of Biotechnology', 2),
  ('FDEG', 'كلية القانون والاقتصاد والتسيير',         'Faculté de Droit, d''Économie et de Gestion',      'Faculty of Law, Economics and Management', 3),
  ('FSHS', 'كلية العلوم الإنسانية والاجتماعية',       'Faculté des Sciences Humaines et Sociales',        'Faculty of Humanities and Social Sciences', 4)
on conflict (code) do nothing;

insert into public.majors (institution_id, code, name_ar, name_fr, name_en, sort)
select i.id, v.code, v.name_ar, v.name_fr, v.name_en, v.sort
from (values
  ('FST',  'GPD', 'هندسة عمليات التحلية',                 'Génie des Procédés de Dessalement',                      'Desalination Process Engineering', 1),
  ('FST',  'GER', 'الهندسة الطاقوية والطاقات المتجددة',   'Génie Énergétique et Énergies Renouvelables',            'Energy Engineering and Renewable Energies', 2),
  ('FST',  'DSI', 'تطوير نظم المعلومات',                  'Développement des Systèmes d''Information',              'Information Systems Development', 3),
  ('FST',  'IAA', 'الذكاء الاصطناعي',                     'Intelligence Artificielle',                              'Artificial Intelligence', 4),
  ('FST',  'GEM', 'الجيولوجيا والتعدين',                  'Géologie et Mines',                                      'Geology and Mining', 5),
  ('FST',  'SDS', 'الإحصاء وعلوم البيانات',               'Statistique et Science des Données',                     'Statistics and Data Science', 6),
  ('ISB',  'SHB', 'العلوم البحرية والتكنولوجيا الحيوية',   'Sciences Marines et Biotechnologie',                     'Marine Sciences and Biotechnology', 1),
  ('FDEG', 'DMH', 'قانون التعدين والموارد الهيدروكربونية', 'Droit Minier et des Ressources Hydrocarbures',          'Mining and Hydrocarbon Resources Law', 1),
  ('FDEG', 'DMP', 'قانون الأنشطة البحرية والمينائية',      'Droit des Activités Maritimes et Portuaires',            'Maritime and Port Activities Law', 2),
  ('FDEG', 'GRE', 'تسيير المخاطر البيئية والساحلية',       'Gestion des Risques Environnementaux et Côtiers',        'Environmental and Coastal Risk Management', 3),
  ('FDEG', 'GAM', 'تسيير الأنشطة البحرية والموانئ',        'Gestion des Activités Maritimes et des Ports',           'Maritime Activities and Port Management', 4),
  ('FSHS', 'MMP', 'الهجرة وحركة السكان',                  'Migration et Mouvements de Population',                  'Migration and Population Movements', 1)
) as v(inst, code, name_ar, name_fr, name_en, sort)
join public.institutions i on i.code = v.inst
on conflict (code) do nothing;

-- Plan templates. A plan is a "template"; what is actually applied to a space is cohorts.features (edited by the super admin feature by feature).
--   ai         the smart assistant, analysis and everything that calls AI (correction, search, lesson indexing, timetable extraction)
--   arena      the ranked quiz
--   ranking    the leaderboard
--   duel       Duel
--   review     mistake review and spaced review
--   recordings  recordings
--   qcm_pdf     QCM download as a PDF file
--   written    written exercises
-- A key missing from features = disabled.
create table if not exists public.plans (
  code text primary key check (code in ('full', 'basic')),
  features jsonb not null
);
insert into public.plans (code, features) values
  ('full',  '{"ai":true,"arena":true,"ranking":true,"duel":true,"review":true,"recordings":true,"qcm_pdf":true,"written":true}'::jsonb),
  ('basic', '{"ai":false,"arena":false,"ranking":false,"duel":false,"review":false,"recordings":false,"qcm_pdf":false,"written":false}'::jsonb)
on conflict (code) do nothing;

-- ───────────────────────── 2) Extend cohorts to become the "space" ─────────────────────────
alter table public.cohorts add column if not exists major_id uuid references public.majors(id) on delete restrict;
alter table public.cohorts add column if not exists level_code text references public.levels(code) on delete restrict;
alter table public.cohorts add column if not exists is_active boolean not null default false; -- false = "coming soon" (greyed out on the login screen)
alter table public.cohorts add column if not exists plan text not null default 'basic' check (plan in ('full', 'basic', 'custom'));
alter table public.cohorts add column if not exists features jsonb not null default '{}'::jsonb;
create unique index if not exists cohorts_major_level_key on public.cohorts(major_id, level_code) where major_id is not null;

-- The current cohort -> the IAA L2 space (converted in place: same id, so no related row changes)
do $$
declare
  iaa uuid;
  main_c uuid;
  n_other integer;
begin
  select id into iaa from public.majors where code = 'IAA';
  if exists (select 1 from public.cohorts where major_id = iaa and level_code = 'L2') then
    return; -- already converted
  end if;

  select count(*) into n_other from public.cohorts where major_id is null;
  -- The cohort with the most students (then the oldest) becomes IAA L2
  select c.id into main_c
  from public.cohorts c
  left join public.profiles p on p.cohort_id = c.id
  where c.major_id is null
  group by c.id
  order by count(p.id) desc, c.created_at asc
  limit 1;

  if main_c is null then
    insert into public.cohorts (name) values ('IAA L2') returning id into main_c;
  end if;

  update public.cohorts
     set name = 'IAA L2', major_id = iaa, level_code = 'L2', is_active = true, plan = 'full',
         features = (select features from public.plans where code = 'full')
   where id = main_c;

  if n_other > 1 then
    raise notice '0017: وُجدت % دفعات؛ حُوّلت الأكثر طلاباً إلى IAA L2 وتُركت البقية دون تغيير (major_id فارغ).', n_other;
  end if;
end $$;

-- ───────────────────────── 3) Tie content to the space ─────────────────────────
-- 3.1 Semesters: each space has its own (S3/S4 for IAA L2; S1/S2 for L1...) and exactly one "current" semester per space.
alter table public.semesters add column if not exists cohort_id uuid references public.cohorts(id) on delete cascade;
update public.semesters
   set cohort_id = (select c.id from public.cohorts c join public.majors m on m.id = c.major_id
                    where m.code = 'IAA' and c.level_code = 'L2')
 where cohort_id is null;
alter table public.semesters alter column cohort_id set not null;
alter table public.semesters drop constraint if exists semesters_code_key;
create unique index if not exists semesters_cohort_code_key on public.semesters(cohort_id, code);
create unique index if not exists semesters_one_current on public.semesters(cohort_id) where is_current;

-- 3.2 Subjects: cohort_id is always derived from the semester (an inserter cannot contradict it), and the code is unique within a space, not globally.
alter table public.subjects add column if not exists cohort_id uuid references public.cohorts(id) on delete cascade;
update public.subjects s set cohort_id = sem.cohort_id from public.semesters sem where sem.id = s.semester_id and s.cohort_id is null;
alter table public.subjects alter column cohort_id set not null;
alter table public.subjects drop constraint if exists subjects_code_key;
create unique index if not exists subjects_cohort_code_key on public.subjects(cohort_id, code);
create index if not exists subjects_cohort_idx on public.subjects(cohort_id, semester_id, sort);

create or replace function public.subjects_set_cohort() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select cohort_id into new.cohort_id from public.semesters where id = new.semester_id;
  if new.cohort_id is null then raise exception 'semester_not_found'; end if;
  return new;
end $$;
drop trigger if exists trg_subjects_cohort on public.subjects;
create trigger trg_subjects_cohort before insert or update of semester_id on public.subjects
  for each row execute function public.subjects_set_cohort();

-- 3.3 Super admin: stays in IAA L2 (their "current" space; they switch from their panel to enter any other space)
update public.profiles
   set cohort_id = (select c.id from public.cohorts c join public.majors m on m.id = c.major_id
                    where m.code = 'IAA' and c.level_code = 'L2')
 where role = 'admin' and cohort_id is null;

-- ───────────────────────── 4) The "space admin" role ─────────────────────────
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'profiles' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* '\mrole\M'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.profiles
  add constraint profiles_role_check check (role in ('student', 'moderator', 'space_admin', 'admin'));

-- ───────────────────────── 5) Permission and plan helper functions ─────────────────────────
create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Space admin (sees only their own space)
create or replace function public.is_space_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'space_admin' from public.profiles where id = auth.uid()), false)
$$;

-- "Manager" of the current space: the super admin (inside the space they entered) or the space admin. Publishes directly and manages all of the space's content.
create or replace function public.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'space_admin') from public.profiles where id = auth.uid()), false)
$$;

-- Staff of the current space: moderator, space admin, super admin. (Space scoping is done in the policies via my_cohort().)
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('moderator', 'space_admin', 'admin') from public.profiles where id = auth.uid()), false)
$$;

-- Direct publishing: super admin and space admin always; a regular moderator according to their permission (the IAA L2 approval system is unchanged)
create or replace function public.can_publish_direct() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'space_admin') or can_publish_direct from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.subject_cohort(p_subject uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select cohort_id from public.subjects where id = p_subject
$$;

create or replace function public.lesson_cohort(p_lesson uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.cohort_id from public.lessons l join public.subjects s on s.id = l.subject_id where l.id = p_lesson
$$;

-- Is the space feature enabled? (missing = disabled)
create or replace function public.cohort_feature(p_cohort uuid, p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (features ->> p_feature)::boolean from public.cohorts where id = p_cohort), false)
$$;

create or replace function public.my_feature(p_feature text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.cohort_feature(public.my_cohort(), p_feature)
$$;

-- ───────────────────────── 6) Create the spaces (major x level) and their semesters ─────────────────────────
-- Creates every missing space (inactive -> "coming soon", basic plan) and its semesters. Called now, and again whenever a new level (L3) is added.
create or replace function public.ensure_spaces() returns integer
language plpgsql security definer set search_path = public as $$
declare
  r record;
  n integer := 0;
  i integer;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'forbidden'; end if;

  for r in
    select m.id as major_id, m.code as major_code, l.code as level_code
    from public.majors m cross join public.levels l
    where not exists (select 1 from public.cohorts c where c.major_id = m.id and c.level_code = l.code)
    order by l.sort, m.sort
  loop
    insert into public.cohorts (name, major_id, level_code, is_active, plan, features)
    values (r.major_code || ' ' || r.level_code, r.major_id, r.level_code, false, 'basic',
            (select features from public.plans where code = 'basic'))
    on conflict (name) do nothing;
    n := n + 1;
  end loop;

  for r in
    select c.id as cohort_id, l.semesters
    from public.cohorts c join public.levels l on l.code = c.level_code
    where c.major_id is not null
  loop
    for i in 1 .. cardinality(r.semesters) loop
      insert into public.semesters (cohort_id, code, name, is_current)
      values (r.cohort_id, r.semesters[i], 'Semestre ' || substring(r.semesters[i] from 2), i = 1)
      on conflict (cohort_id, code) do nothing;
    end loop;
  end loop;
  return n;
end $$;

select public.ensure_spaces();

-- ───────────────────────── 7) Space directory for the login screen (before sign-in) ─────────────────────
-- Shows names and open/closed status only: no plans, no counts, no student data. Executable by anon on purpose.
create or replace function public.public_directory() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'levels', coalesce((select jsonb_agg(l.code order by l.sort) from public.levels l), '[]'::jsonb),
    'institutions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'code', i.code,
        'name', jsonb_build_object('ar', i.name_ar, 'fr', i.name_fr, 'en', i.name_en),
        'majors', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', m.id, 'code', m.code,
            'name', jsonb_build_object('ar', m.name_ar, 'fr', m.name_fr, 'en', m.name_en),
            'spaces', coalesce((
              select jsonb_agg(jsonb_build_object('id', c.id, 'level', c.level_code, 'open', c.is_active) order by lv.sort)
              from public.cohorts c join public.levels lv on lv.code = c.level_code
              where c.major_id = m.id), '[]'::jsonb)
          ) order by m.sort)
          from public.majors m where m.institution_id = i.id), '[]'::jsonb)
      ) order by i.sort)
      from public.institutions i), '[]'::jsonb)
  )
$$;

-- ───────────────────────── 8) RLS and privileges for the new tables ─────────────────────────
alter table public.levels enable row level security;
alter table public.institutions enable row level security;
alter table public.majors enable row level security;
alter table public.plans enable row level security;

drop policy if exists levels_read on public.levels;
create policy levels_read on public.levels for select to authenticated using (true);
drop policy if exists levels_admin on public.levels;
create policy levels_admin on public.levels for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists institutions_read on public.institutions;
create policy institutions_read on public.institutions for select to authenticated using (true);
drop policy if exists institutions_admin on public.institutions;
create policy institutions_admin on public.institutions for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists majors_read on public.majors;
create policy majors_read on public.majors for select to authenticated using (true);
drop policy if exists majors_admin on public.majors;
create policy majors_admin on public.majors for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (true);
drop policy if exists plans_admin on public.plans;
create policy plans_admin on public.plans for all to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.levels, public.institutions, public.majors, public.plans from anon, authenticated;
grant select on public.levels, public.institutions, public.majors, public.plans to authenticated;
grant insert, update, delete on public.levels, public.institutions, public.majors, public.plans to authenticated; -- RLS restricts these to the super admin
grant all on public.levels, public.institutions, public.majors, public.plans to service_role;

-- ───────────────────────── 9) Privileges of the new functions ─────────────────────────
revoke all on function public.my_role() from public, anon;
revoke all on function public.is_space_admin() from public, anon;
revoke all on function public.is_manager() from public, anon;
revoke all on function public.subject_cohort(uuid) from public, anon;
revoke all on function public.lesson_cohort(uuid) from public, anon;
revoke all on function public.cohort_feature(uuid, text) from public, anon;
revoke all on function public.my_feature(text) from public, anon;
revoke all on function public.subjects_set_cohort() from public, anon;
revoke all on function public.ensure_spaces() from public, anon, authenticated;
revoke all on function public.public_directory() from public;
grant execute on function public.my_role(), public.is_space_admin(), public.is_manager(),
  public.subject_cohort(uuid), public.lesson_cohort(uuid), public.cohort_feature(uuid, text),
  public.my_feature(text) to authenticated, service_role;
grant execute on function public.ensure_spaces() to service_role;
grant execute on function public.public_directory() to anon, authenticated, service_role;
