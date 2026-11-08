-- 0027: back to a single space (IAA L2). No table, data or account is deleted.
-- Keeps IAA L2 active with the full plan and all features, and makes the other spaces inactive (hidden from public_directory).
-- Idempotent: re-running changes nothing (the backup is saved only once).
-- Rollback: see 0027_single_space_down.sql.txt and the spec section.

create table if not exists public.single_space_backup (
  kind text not null check (kind in ('cohort', 'admin_profile')),
  id uuid not null,
  is_active boolean,
  plan text,
  features jsonb,
  cohort_id uuid,
  saved_at timestamptz not null default now(),
  primary key (kind, id)
);
alter table public.single_space_backup enable row level security; -- no policies: for the service role / SQL editor only

do $$
declare
  iaa uuid;
  iaa_major uuid;
begin
  select id into iaa_major from public.majors where code = 'IAA';
  select id into iaa from public.cohorts where major_id = iaa_major and level_code = 'L2';
  if iaa is null then
    raise exception '0027: فضاء IAA L2 غير موجود';
  end if;

  -- Backup of the spaces' state (not replaced if it exists)
  insert into public.single_space_backup (kind, id, is_active, plan, features)
  select 'cohort', c.id, c.is_active, c.plan, c.features from public.cohorts c
  on conflict (kind, id) do nothing;

  -- Backup of the moderators' current space
  insert into public.single_space_backup (kind, id, cohort_id)
  select 'admin_profile', p.id, p.cohort_id from public.profiles p where p.role = 'admin'
  on conflict (kind, id) do nothing;

  -- IAA L2: active, full plan, all features
  update public.cohorts
     set is_active = true,
         plan = 'full',
         features = coalesce((select features from public.plans where code = 'full'), '{}'::jsonb)
                    || '{"ai":true,"arena":true,"ranking":true,"duel":true,"review":true,"recordings":true,"qcm_pdf":true,"written":true,"chat":true}'::jsonb
   where id = iaa;

  -- All other spaces: only made inactive (nothing is deleted)
  update public.cohorts set is_active = false where id <> iaa and is_active;

  -- The super admin works inside IAA L2 (RLS relies on cohort_id)
  update public.profiles set cohort_id = iaa where role = 'admin' and cohort_id is distinct from iaa;
end $$;
