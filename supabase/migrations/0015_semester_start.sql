-- ════════════════════════════════════════════════════════════════════════════
-- 0015 - semester start date (for study-week numbering)
--   - semesters.start_date: the semester start date (optional). Week 1 = the week (from Monday)
--     containing this date. The admin edits it from the admin panel -> timetable.
--   - S3 value = 2026-10-12 (week 1 = Monday 12 to Saturday 17 October 2026).
-- Idempotent. No new tables: no new GRANT or policies are needed
-- (the semesters table is unchanged: readable by enrolled users, writable only by the admin through the semesters_admin policy).
-- Never re-run 0002.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.semesters add column if not exists start_date date;

-- Sets the initial S3 value only if it is not already set (never overwrites an admin edit)
update public.semesters set start_date = date '2026-10-12'
where code = 'S3' and start_date is null;
