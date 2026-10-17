-- بحث نصي احتياطي أكثر تسامحاً: كلمات السؤال تُربط بـ OR (لا AND)، فيكفي تطابق كلمة مميزة
-- مثل «apprentissage supervisé» حتى لو كان السؤال يحوي كلمات أخرى («selon le cours»).
create or replace function public.search_chunks_text(
  p_query text, p_subject uuid default null, p_lesson uuid default null, p_k integer default 6
) returns table (
  id uuid, lesson_id uuid, page integer, content text, similarity real,
  lesson_kind text, lesson_number integer, lesson_title text, subject_code text
)
language sql stable set search_path = public as $$
  with q as (
    select nullif(replace(plainto_tsquery('french', p_query)::text, ' & ', ' | '), '')::tsquery as tq
  )
  select c.id, c.lesson_id, c.page, c.content,
         ts_rank(c.tsv, q.tq)::real,
         l.kind, l.number, l.title, s.code
  from q
  join public.lesson_chunks c on q.tq is not null and c.tsv @@ q.tq
  join public.lessons l on l.id = c.lesson_id
  join public.subjects s on s.id = c.subject_id
  where (p_lesson is null or c.lesson_id = p_lesson)
    and (p_lesson is not null or p_subject is null or c.subject_id = p_subject)
  order by 5 desc
  limit least(greatest(p_k, 1), 20)
$$;

revoke all on function public.search_chunks_text(text, uuid, uuid, integer) from public, anon;
grant execute on function public.search_chunks_text(text, uuid, uuid, integer) to authenticated, service_role;
