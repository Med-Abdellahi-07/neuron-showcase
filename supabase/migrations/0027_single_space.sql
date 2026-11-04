-- 0027: العودة إلى فضاء واحد (IAA L2). لا حذف لأي جدول أو بيانات أو حسابات.
-- يبقي IAA L2 نشطاً بالخطة الكاملة وكل الميزات، ويجعل بقية الفضاءات غير نشطة (مخفية من public_directory).
-- idempotent: التشغيل المتكرر لا يغيّر شيئاً (النسخة الاحتياطية تُحفظ مرة واحدة فقط).
-- التراجع (rollback): انظر الملف 0027_single_space_down.sql.txt وقسم الـ spec.

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
alter table public.single_space_backup enable row level security;  -- لا سياسات: للخدمة/المحرر فقط

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

  -- نسخة احتياطية لحالة الفضاءات (لا تُستبدل إن وُجدت)
  insert into public.single_space_backup (kind, id, is_active, plan, features)
  select 'cohort', c.id, c.is_active, c.plan, c.features from public.cohorts c
  on conflict (kind, id) do nothing;

  -- نسخة احتياطية لفضاء المشرفين الحالي
  insert into public.single_space_backup (kind, id, cohort_id)
  select 'admin_profile', p.id, p.cohort_id from public.profiles p where p.role = 'admin'
  on conflict (kind, id) do nothing;

  -- IAA L2: نشط، خطة كاملة، كل الميزات
  update public.cohorts
     set is_active = true,
         plan = 'full',
         features = coalesce((select features from public.plans where code = 'full'), '{}'::jsonb)
                    || '{"ai":true,"arena":true,"ranking":true,"duel":true,"review":true,"recordings":true,"qcm_pdf":true,"written":true,"chat":true}'::jsonb
   where id = iaa;

  -- بقية الفضاءات: غير نشطة فقط (لا حذف)
  update public.cohorts set is_active = false where id <> iaa and is_active;

  -- المشرف العام يعمل داخل IAA L2 (RLS تعتمد cohort_id)
  update public.profiles set cohort_id = iaa where role = 'admin' and cohort_id is distinct from iaa;
end $$;
