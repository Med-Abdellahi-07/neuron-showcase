-- ══════════════════════════════════════════════════════════════════════════
-- 0019 - statistics dashboards: university (super admin) and space (space manager)
-- After 0018. Safe to re-run. Aggregated statistics only (no conversation content and no individual answers).
-- ══════════════════════════════════════════════════════════════════════════

-- Single-space dashboard: returns only the user's current space (space manager or super admin inside their space)
create or replace function public.space_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  coh uuid := public.my_cohort();
  res jsonb;
begin
  if not public.is_manager() then raise exception 'forbidden'; end if;
  if coh is null then return '{}'::jsonb; end if;
  select jsonb_build_object(
    'students', (select count(*) from public.profiles p where p.cohort_id = coh and p.role = 'student'),
    'active_1d', (select count(*) from public.profiles p where p.cohort_id = coh and p.role = 'student' and p.last_seen_at > now() - interval '1 day'),
    'active_7d', (select count(*) from public.profiles p where p.cohort_id = coh and p.role = 'student' and p.last_seen_at > now() - interval '7 days'),
    'never_logged', (select count(*) from public.profiles p where p.cohort_id = coh and p.role = 'student' and p.last_seen_at is null),
    'subjects', (select count(*) from public.subjects s where s.cohort_id = coh),
    'lessons_published', (select count(*) from public.lessons l join public.subjects s on s.id = l.subject_id where s.cohort_id = coh and l.status = 'published'),
    'lessons_pending', (select count(*) from public.lessons l join public.subjects s on s.id = l.subject_id where s.cohort_id = coh and l.status = 'pending'),
    'questions_published', (select count(*) from public.questions q join public.subjects s on s.id = q.subject_id where s.cohort_id = coh and q.status = 'published'),
    'questions_pending', (select count(*) from public.questions q join public.subjects s on s.id = q.subject_id where s.cohort_id = coh and q.status = 'pending'),
    'sessions_next_7d', (select count(*) from public.schedule_sessions ss where ss.cohort_id = coh and ss.status <> 'cancelled'
                         and ss.session_date between current_date and current_date + 7),
    'announcements', (select count(*) from public.announcements a where a.cohort_id = coh),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'full_name', p.full_name, 'role', p.role, 'last_seen_at', p.last_seen_at)
                       order by p.last_seen_at desc nulls last)
      from public.profiles p where p.cohort_id = coh and p.role in ('space_admin', 'moderator')), '[]'::jsonb),
    'recent_students', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'full_name', x.full_name, 'last_seen_at', x.last_seen_at))
      from (select p.id, p.full_name, p.last_seen_at from public.profiles p
            where p.cohort_id = coh and p.role = 'student' order by p.last_seen_at desc nulls last limit 5) x), '[]'::jsonb)
  ) into res;
  return res;
end $$;

-- University dashboard: one row per space + the last activity of each moderator. Super admin only.
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'spaces', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'level', c.level_code, 'is_active', c.is_active, 'plan', c.plan,
        'institution', i.code, 'major', m.code,
        'students', (select count(*) from public.profiles p where p.cohort_id = c.id and p.role = 'student'),
        'active_7d', (select count(*) from public.profiles p where p.cohort_id = c.id and p.role = 'student' and p.last_seen_at > now() - interval '7 days'),
        'supervisors', (select count(*) from public.profiles p where p.cohort_id = c.id and p.role = 'space_admin'),
        'lessons', (select count(*) from public.lessons l join public.subjects s on s.id = l.subject_id where s.cohort_id = c.id and l.status = 'published'),
        'questions', (select count(*) from public.questions q join public.subjects s on s.id = q.subject_id where s.cohort_id = c.id and q.status = 'published'),
        'last_content_at', (select max(t) from (
            select max(l.created_at) t from public.lessons l join public.subjects s on s.id = l.subject_id where s.cohort_id = c.id
            union all
            select max(q.created_at) from public.questions q join public.subjects s on s.id = q.subject_id where s.cohort_id = c.id) z)
      ) order by i.sort, m.sort, lv.sort)
      from public.cohorts c
      left join public.majors m on m.id = c.major_id
      left join public.institutions i on i.id = m.institution_id
      left join public.levels lv on lv.code = c.level_code), '[]'::jsonb),
    'supervisors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'full_name', p.full_name, 'role', p.role, 'space', c.name, 'last_seen_at', p.last_seen_at,
        'last_upload_at', (select max(t) from (
            select max(l.created_at) t from public.lessons l where l.created_by = p.id
            union all select max(q.created_at) from public.questions q where q.created_by = p.id) z))
        order by p.last_seen_at desc nulls last)
      from public.profiles p left join public.cohorts c on c.id = p.cohort_id
      where p.role in ('space_admin', 'moderator')), '[]'::jsonb)
  ) into res;
  return res;
end $$;

revoke all on function public.space_dashboard(), public.admin_overview() from public, anon;
grant execute on function public.space_dashboard(), public.admin_overview() to authenticated, service_role;
