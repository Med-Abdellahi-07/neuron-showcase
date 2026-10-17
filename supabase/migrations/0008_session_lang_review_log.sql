-- لغة الجلسة (الفرنسية افتراضياً لأن الدروس بها) وسجل أسئلة المراجعة (مصدر كل سؤال ونتيجته).
alter table public.conversations add column if not exists lang text not null default 'fr' check (lang in ('fr', 'ar'));
alter table public.conversations add column if not exists review_log jsonb not null default '[]'::jsonb;
