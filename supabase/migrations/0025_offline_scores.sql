-- 0025: مزامنة نتائج QCM المنجزة بدون إنترنت (تمرين فقط، لا علاقة لها بالترتيب).
-- آمن لإعادة التشغيل. لا يمس أي جدول موجود.

create table if not exists public.offline_scores (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  cohort_id  uuid references public.cohorts(id) on delete set null,
  lesson_id  uuid references public.lessons(id) on delete set null,
  correct    int  not null check (correct >= 0),
  total      int  not null check (total between 1 and 50),
  taken_at   timestamptz not null,
  created_at timestamptz not null default now(),
  check (correct <= total),
  unique (user_id, client_id)
);
create index if not exists offline_scores_user_idx on public.offline_scores (user_id, taken_at desc);

-- RLS مغلق: لا قراءة ولا كتابة مباشرة، فقط عبر الدالة
alter table public.offline_scores enable row level security;
revoke all on public.offline_scores from anon, authenticated;

-- تُرجع مصفوفة client_id التي عولجت (قُبلت أو رُفضت نهائيًا) ليحذفها الجهاز من صندوق الإرسال
create or replace function public.record_offline_scores(p_scores jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  coh uuid;
  s jsonb;
  cid uuid; lid uuid; c int; t int; at timestamptz;
  done jsonb := '[]'::jsonb;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_scores) <> 'array' then raise exception 'bad_scores'; end if;
  if jsonb_array_length(p_scores) > 100 then raise exception 'too_many'; end if;
  select cohort_id into coh from public.profiles where id = uid;

  for s in select * from jsonb_array_elements(p_scores) loop
    begin
      cid := (s->>'client_id')::uuid;
      c := (s->>'correct')::int;
      t := (s->>'total')::int;
      at := (s->>'taken_at')::timestamptz;
      lid := nullif(s->>'lesson_id', '')::uuid;
    exception when others then
      continue; -- صف تالف: يُتجاهل (لا client_id موثوق لإرجاعه)
    end;
    -- قيم غير معقولة: تُعدّ معالجة (مرفوضة نهائيًا) كي لا تتكرر
    if c < 0 or t < 1 or t > 50 or c > t or at > now() + interval '5 minutes' or at < now() - interval '90 days' then
      done := done || to_jsonb(cid::text);
      continue;
    end if;
    -- الحصة يجب أن تكون ضمن مواد الطالب؛ وإلا تُسجَّل بلا ربط
    if lid is not null and not exists (
      select 1 from public.lessons l join public.subjects sb on sb.id = l.subject_id join public.semesters sm on sm.id = sb.semester_id
      where l.id = lid and (sm.cohort_id = coh or public.follows_subject(l.subject_id))) then
      lid := null;
    end if;
    insert into public.offline_scores (client_id, user_id, cohort_id, lesson_id, correct, total, taken_at)
    values (cid, uid, coh, lid, c, t, at)
    on conflict (user_id, client_id) do nothing;
    done := done || to_jsonb(cid::text);
  end loop;
  return done;
end $$;

revoke all on function public.record_offline_scores(jsonb) from public, anon;
grant execute on function public.record_offline_scores(jsonb) to authenticated;
