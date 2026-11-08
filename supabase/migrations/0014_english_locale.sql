-- ════════════════════════════════════════════════════════════════════════════
-- 0014 - English as the third interface language
--   - profiles.locale: was restricted to ('ar','fr'), now ('ar','fr','en')
--   - conversations.lang (language of guided sessions): was ('fr','ar'), now ('fr','ar','en')
-- Idempotent. No new tables, so no new GRANT or policies are needed:
-- the columns, their privileges and the RLS policies on both tables are unchanged.
-- Never re-run 0002.
-- ════════════════════════════════════════════════════════════════════════════

-- Drops any CHECK constraint on the column (whatever its automatic name) and then adds the new one under a fixed name
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'profiles' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* '\mlocale\M'
  loop
    execute format('alter table public.profiles drop constraint %I', r.conname);
  end loop;

  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'conversations' and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ~* '\mlang\M'
  loop
    execute format('alter table public.conversations drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.profiles
  add constraint profiles_locale_check check (locale in ('ar', 'fr', 'en'));

alter table public.conversations
  add constraint conversations_lang_check check (lang in ('fr', 'ar', 'en'));
