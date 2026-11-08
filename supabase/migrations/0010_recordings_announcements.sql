-- Neuron - phase 4 (1/4): recordings + announcement expiry.
-- Run after 0009 from Supabase -> SQL Editor. Safe to run more than once.
-- (Never re-run 0002.)

-- ───────────────────────── Recordings (remote sessions) ─────────────────────────
-- Cohort-specific. Linked to a lesson (optional lesson_id) or to (subject + type + date).
-- provider: youtube (only the video id is stored and played through youtube-nocookie) or drive (preview link).
create table if not exists public.recordings (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  kind text not null check (kind in ('cm', 'td', 'tp')),
  rec_date date not null,
  lesson_id uuid references public.lessons(id) on delete set null,
  title text not null,
  provider text not null check (provider in ('youtube', 'drive')),
  video_id text not null check (length(video_id) between 6 and 128 and video_id ~ '^[A-Za-z0-9_-]+$'),
  duration_seconds integer check (duration_seconds is null or duration_seconds > 0),
  status text not null default 'draft' check (status in ('draft', 'pending', 'published')),
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists recordings_subject_idx on public.recordings(cohort_id, subject_id, rec_date desc);
create index if not exists recordings_lesson_idx on public.recordings(lesson_id) where lesson_id is not null;

-- Time index (markers inside the video): the structure is ready now, the UI comes later.
create table if not exists public.recording_marks (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.recordings(id) on delete cascade,
  at_seconds integer not null check (at_seconds >= 0),
  label text not null check (length(label) between 1 and 200),
  sort smallint not null default 0,
  created_by uuid references public.profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists recording_marks_idx on public.recording_marks(recording_id, at_seconds);

alter table public.recordings enable row level security;
alter table public.recording_marks enable row level security;

drop policy if exists recordings_read on public.recordings;
create policy recordings_read on public.recordings for select to authenticated
  using (public.is_staff() or (status = 'published' and cohort_id = public.my_cohort()));
drop policy if exists recordings_insert on public.recordings;
create policy recordings_insert on public.recordings for insert to authenticated
  with check (public.is_staff());
drop policy if exists recordings_update on public.recordings;
create policy recordings_update on public.recordings for update to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid()
         and (status <> 'published' or public.can_publish_direct())))
  with check (public.is_staff());
drop policy if exists recordings_delete on public.recordings;
create policy recordings_delete on public.recordings for delete to authenticated
  using (public.is_admin() or (public.is_staff() and created_by = auth.uid() and status <> 'published'));

drop policy if exists marks_read on public.recording_marks;
create policy marks_read on public.recording_marks for select to authenticated
  using (exists (select 1 from public.recordings r where r.id = recording_id
                 and (public.is_staff() or (r.status = 'published' and r.cohort_id = public.my_cohort()))));
drop policy if exists marks_write on public.recording_marks;
create policy marks_write on public.recording_marks for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Same approval system: a moderator without "publish directly" has their posts set to "pending approval"
drop trigger if exists trg_recordings_publish on public.recordings;
create trigger trg_recordings_publish before insert or update on public.recordings
  for each row execute function public.enforce_publish_rule();

revoke all on public.recordings, public.recording_marks from anon;
grant select, insert, update, delete on public.recordings, public.recording_marks to authenticated;
grant all on public.recordings, public.recording_marks to service_role;

-- ───────────────────────── Announcements: optional expiry date ─────────────────────────
alter table public.announcements add column if not exists expires_at timestamptz;

-- Students do not see expired ones; moderators/admins see everything
drop policy if exists announcements_read on public.announcements;
create policy announcements_read on public.announcements for select to authenticated
  using (public.is_staff() or (cohort_id = public.my_cohort() and (expires_at is null or expires_at > now())));

-- Announcements are written by the admin only (the announcements_admin policy from 0001 still applies)
