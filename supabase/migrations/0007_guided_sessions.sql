-- جلسات موجّهة (شرح/مراجعة/حل تمرين): نطاق متعدد الحصص وحالة التقدم، ودالة نافذة المقاطع بالترتيب.
alter table public.conversations add column if not exists lesson_ids uuid[] not null default '{}';
alter table public.conversations add column if not exists question_id uuid references public.questions(id) on delete set null;
alter table public.conversations add column if not exists cursor integer not null default 0;   -- شرح: فهرس أول مقطع في الجزء الحالي
alter table public.conversations add column if not exists total integer not null default 0;    -- عدد مقاطع النطاق عند البدء
alter table public.conversations add column if not exists step integer not null default 0;     -- مراجعة: رقم السؤال الحالي (6 = انتهت)
alter table public.conversations add column if not exists guided boolean not null default false;

-- مقاطع نطاق (حصص محددة أو كل حصص المادة) بترتيب الدرس: CM ثم TD ثم TP ثم Résumé، فالرقم، فالصفحة.
-- security invoker: RLS يطبَّق، فلا يرى الطالب إلا الحصص المنشورة.
create or replace function public.lesson_window(
  p_subject uuid, p_lessons uuid[], p_start integer, p_limit integer
) returns table (
  ord integer, total integer, lesson_id uuid, page integer, content text,
  lesson_kind text, lesson_number integer, lesson_title text, subject_code text
)
language sql stable set search_path = public as $$
  with sel as (
    select (row_number() over (
             order by case l.kind when 'cm' then 0 when 'td' then 1 when 'tp' then 2 else 3 end,
                      l.number, c.page, c.chunk_index) - 1)::integer as ord,
           c.lesson_id, c.page, c.content, l.kind::text as kind, l.number, l.title, s.code
    from public.lesson_chunks c
    join public.lessons l on l.id = c.lesson_id
    join public.subjects s on s.id = c.subject_id
    where (coalesce(cardinality(p_lessons), 0) > 0 and c.lesson_id = any (p_lessons))
       or (coalesce(cardinality(p_lessons), 0) = 0 and c.subject_id = p_subject)
  )
  select sel.ord, (select count(*) from sel)::integer, sel.lesson_id, sel.page, sel.content,
         sel.kind, sel.number, sel.title, sel.code
  from sel
  where sel.ord >= greatest(p_start, 0)
  order by sel.ord
  limit least(greatest(p_limit, 0), 40)
$$;

revoke all on function public.lesson_window(uuid, uuid[], integer, integer) from public, anon;
grant execute on function public.lesson_window(uuid, uuid[], integer, integer) to authenticated, service_role;
