-- ════════════════════════════════════════════════════════════════════════════
-- 0014 — اللغة الإنجليزية كلغة ثالثة للواجهة
--   • profiles.locale  : كان مقيَّداً بـ ('ar','fr') ← يصبح ('ar','fr','en')
--   • conversations.lang (لغة الجلسات الموجّهة): كان ('fr','ar') ← ('fr','ar','en')
-- آمن لإعادة التشغيل (idempotent). لا جداول جديدة، فلا حاجة إلى GRANT أو سياسات جديدة:
-- الأعمدة نفسها وصلاحياتها وسياسات RLS على الجدولين كما هي.
-- لا تُعد تشغيل 0002.
-- ════════════════════════════════════════════════════════════════════════════

-- يحذف أي قيد CHECK على العمود (مهما كان اسمه التلقائي) ثم يضيف القيد الجديد باسم ثابت
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
