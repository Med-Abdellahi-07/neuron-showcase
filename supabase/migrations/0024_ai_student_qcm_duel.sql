-- 0024: QCM بالذكاء الاصطناعي بعدد حر (1..50) + Duel بأسئلة يولّدها الذكاء الاصطناعي (بعد 0023، idempotent).
-- • ai_qcm_sets.question_count: من (5,10,20) إلى 1..50.
-- • ai_costs: نوع 'duel' (علم ai_duel) ليُحسب طلب توليد Duel ضمن السقف الخفي.
-- • أسئلة Duel المولَّدة تُخزَّن في questions بحالة جديدة 'private': لا يقرؤها الطلاب ولا الطاقم ولا تدخل أي تمرين أو QCM أو ترتيب
--   (كل المحددات تشترط published)، وتصل للاعبي التحدي فقط عبر دوال duel_* (security definer) كما تصل أسئلة المشرف.
-- • create_ai_duel: للخادم فقط (service_role)، لأن من يستدعيها يحدد الأسئلة والأجوبة؛ التحقق من الهوية والفضاء يتم داخلها.

-- ───────────────────────── 1) عدد حر في ai_qcm_sets ─────────────────────────
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.ai_qcm_sets'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%question_count%'
  loop
    execute format('alter table public.ai_qcm_sets drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.ai_qcm_sets add constraint ai_qcm_sets_question_count_check check (question_count between 1 and 50);

-- ───────────────────────── 2) تكلفة Duel ─────────────────────────
insert into public.ai_costs (kind, points, flag) values ('duel', 1, 'ai_duel') on conflict (kind) do nothing;

-- ───────────────────────── 3) حالة 'private' للأسئلة + إخفاؤها عن الطاقم ─────────────────────────
-- (تحافظ السياسة على فرع «المواد المتبقية» من 0020 كما هو؛ التغيير الوحيد: الطاقم لا يرى private)
do $$
declare r record;
begin
  for r in select c.conname from pg_constraint c
           where c.conrelid = 'public.questions'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%draft%'
  loop
    execute format('alter table public.questions drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.questions add constraint questions_status_check check (status in ('draft', 'pending', 'published', 'private'));

drop policy if exists questions_read on public.questions;
create policy questions_read on public.questions for select to authenticated
  using ((public.subject_cohort(subject_id) = public.my_cohort() and (status = 'published' or (public.is_staff() and status <> 'private')))
         or (status = 'published' and public.follows_subject(subject_id)
             and (type = 'mcq' or public.cohort_feature(public.subject_cohort(subject_id), 'written'))));

-- ───────────────────────── 4) تنظيف أسئلة Duel القديمة (أكثر من 90 يومًا) ─────────────────────────
create or replace function public.duel_sweep() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.duels
    set status = 'expired', winner_id = challenger_id, completed_at = now()
    where status = 'open' and expires_at <= now();
  update public.duels
    set status = 'cancelled', completed_at = now()
    where status = 'challenger_turn' and created_at < now() - interval '24 hours';
  delete from public.questions where status = 'private' and created_at < now() - interval '90 days';
end $$;

-- ───────────────────────── 5) إنشاء Duel بأسئلة مولَّدة (service_role فقط) ─────────────────────────
-- p_questions: [{"statement","options":[4],"correct_index":0-3,"explanation","lesson":uuid|null}] بين 5 و15 سؤالًا.
create or replace function public.create_ai_duel(
  p_uid uuid, p_opponent uuid, p_subject uuid, p_lessons uuid[], p_questions jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  coh uuid;
  q jsonb;
  ids uuid[] := '{}';
  qid uuid;
  lid uuid;
  new_id uuid;
  n integer;
begin
  if p_uid is null then raise exception 'not_authenticated'; end if;
  select cohort_id into coh from public.profiles where id = p_uid;
  if coh is null then raise exception 'no_space'; end if;
  if not public.cohort_feature(coh, 'duel') or not public.ai_flag(coh, 'ai_duel') then raise exception 'feature_disabled'; end if;
  perform public.duel_sweep();
  if p_opponent is null or p_opponent = p_uid
     or not exists (select 1 from public.profiles where id = p_opponent and cohort_id = coh and role = 'student')
  then raise exception 'bad_opponent'; end if;
  if p_subject is null or public.subject_cohort(p_subject) is distinct from coh then raise exception 'bad_subject'; end if;
  p_lessons := coalesce(p_lessons, '{}');
  if jsonb_typeof(p_questions) <> 'array' then raise exception 'bad_questions'; end if;
  n := jsonb_array_length(p_questions);
  if n < 5 then raise exception 'not_enough_questions'; end if;
  if n > 15 then raise exception 'bad_questions'; end if;

  perform pg_advisory_xact_lock(hashtext('create_duel:' || p_uid::text));
  if exists (select 1 from public.duels d
             where d.status in ('challenger_turn', 'open')
               and ((d.challenger_id = p_uid and d.opponent_id = p_opponent)
                 or (d.challenger_id = p_opponent and d.opponent_id = p_uid)))
  then raise exception 'duel_exists'; end if;
  if (select count(*) from public.duels where challenger_id = p_uid and created_at > now() - interval '1 day') >= 10
  then raise exception 'too_many'; end if;

  for q in select * from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q -> 'options') <> 'array' or jsonb_array_length(q -> 'options') <> 4
       or coalesce(btrim(q ->> 'statement'), '') = '' or coalesce((q ->> 'correct_index')::int, -1) not between 0 and 3
    then raise exception 'bad_questions'; end if;
    lid := null;
    if q ->> 'lesson' is not null and q ->> 'lesson' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select l.id into lid from public.lessons l where l.id = (q ->> 'lesson')::uuid and public.lesson_cohort(l.id) = coh;
    end if;
    insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, explanation, status, created_by)
    values (p_subject, lid, 'mcq', 'medium', left(btrim(q ->> 'statement'), 600), q -> 'options', (q ->> 'correct_index')::smallint,
            left(coalesce(q ->> 'explanation', ''), 700), 'private', p_uid)
    returning id into qid;
    ids := ids || qid;
  end loop;

  insert into public.duels (cohort_id, challenger_id, opponent_id, subject_id, lesson_ids, question_ids)
  values (coh, p_uid, p_opponent, p_subject, p_lessons, ids)
  returning id into new_id;
  insert into public.duel_players (duel_id, user_id) values (new_id, p_uid), (new_id, p_opponent);
  return new_id;
end $$;

revoke all on function public.create_ai_duel(uuid, uuid, uuid, uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.create_ai_duel(uuid, uuid, uuid, uuid[], jsonb) to service_role;
