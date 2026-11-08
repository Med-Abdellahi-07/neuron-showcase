-- Session language (French by default because the lessons are in French) and the review question log (each question's source and result).
alter table public.conversations add column if not exists lang text not null default 'fr' check (lang in ('fr', 'ar'));
alter table public.conversations add column if not exists review_log jsonb not null default '[]'::jsonb;
