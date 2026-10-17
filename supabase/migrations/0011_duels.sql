-- Neuron — المرحلة 4 (2/4): Duel (مواجهة غير متزامنة).
-- يُنفَّذ بعد 0010. آمن للتنفيذ أكثر من مرة.
--
-- مبادئ الأمان:
--  • الجداول مغلقة تماماً على المتصفح (RLS مفعّل + لا GRANT): كل شيء عبر دوال security definer.
--  • أسئلة Duel تُرسل بلا الإجابة الصحيحة. لا يُكشف أي تصحيح لأحد (ولا للمتحدّي نفسه) قبل أن ينتهي
--    الطرفان أو تنتهي المهلة، فلا تتسرّب إجابات المتحدّي للخصم ولا الإجابات الصحيحة.
--  • دورة الحياة: challenger_turn (المتحدّي يجيب) ← open (بانتظار الخصم 48 ساعة) ← completed | expired.
--    انتهاء مهلة الـ48 ساعة = فوز المتحدّي. تحدّ لم يُكمله المتحدّي خلال 24 ساعة يُلغى بلا نتيجة.

create table if not exists public.duels (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  challenger_id uuid not null references public.profiles(id) on delete cascade,
  opponent_id uuid not null references public.profiles(id) on delete cascade,
  subject_id uuid references public.subjects(id) on delete set null,
  lesson_ids uuid[] not null default '{}',
  question_ids uuid[] not null,
  status text not null default 'challenger_turn'
    check (status in ('challenger_turn', 'open', 'completed', 'expired', 'cancelled')),
  winner_id uuid references public.profiles(id) on delete set null,
  is_draw boolean not null default false,
  created_at timestamptz not null default now(),
  opened_at timestamptz,
  expires_at timestamptz,
  completed_at timestamptz,
  constraint duel_distinct check (challenger_id <> opponent_id)
);
create index if not exists duels_challenger_idx on public.duels(challenger_id, created_at desc);
create index if not exists duels_opponent_idx on public.duels(opponent_id, created_at desc);
create index if not exists duels_open_idx on public.duels(expires_at) where status = 'open';

create table if not exists public.duel_players (
  duel_id uuid not null references public.duels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz,
  finished_at timestamptz,
  answered smallint not null default 0,
  correct smallint not null default 0,
  points numeric(7, 2) not null default 0,
  total_ms integer not null default 0,
  primary key (duel_id, user_id)
);

create table if not exists public.duel_answers (
  duel_id uuid not null references public.duels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  selected_index smallint not null,
  is_correct boolean not null,
  points numeric(5, 2) not null default 0,
  elapsed_ms integer not null default 0,
  answered_at timestamptz not null default now(),
  primary key (duel_id, user_id, question_id)
);

alter table public.duels enable row level security;
alter table public.duel_players enable row level security;
alter table public.duel_answers enable row level security;
-- بلا سياسات للمستخدم عمداً: الوصول عبر الدوال فقط.
revoke all on public.duels, public.duel_players, public.duel_answers from anon, authenticated;
grant all on public.duels, public.duel_players, public.duel_answers to service_role;

-- ───────────────────────── مساعدات داخلية ─────────────────────────
-- إنهاء ما انتهت مهلته: open → expired بفوز المتحدّي؛ challenger_turn قديم → cancelled.
create or replace function public.duel_sweep() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.duels
    set status = 'expired', winner_id = challenger_id, completed_at = now()
    where status = 'open' and expires_at <= now();
  update public.duels
    set status = 'cancelled', completed_at = now()
    where status = 'challenger_turn' and created_at < now() - interval '24 hours';
end $$;

-- ───────────────────────── إنشاء تحدٍّ ─────────────────────────
create or replace function public.create_duel(
  p_opponent uuid, p_subject uuid, p_lessons uuid[] default '{}', p_count integer default 8
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  ids uuid[];
  new_id uuid;
  n integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.duel_sweep();
  if p_opponent is null or p_opponent = uid then raise exception 'bad_opponent'; end if;
  if public.my_cohort() is null
     or not exists (select 1 from public.profiles where id = p_opponent and cohort_id = public.my_cohort())
  then raise exception 'bad_opponent'; end if;
  if p_subject is null then raise exception 'bad_subject'; end if;
  p_lessons := coalesce(p_lessons, '{}');
  p_count := least(greatest(coalesce(p_count, 8), 5), 15);

  -- حماية من الإزعاج: تحدٍّ واحد جارٍ مع كل زميل، و10 تحديات جديدة كحد أقصى في اليوم
  if exists (select 1 from public.duels d
             where d.status in ('challenger_turn', 'open')
               and ((d.challenger_id = uid and d.opponent_id = p_opponent)
                 or (d.challenger_id = p_opponent and d.opponent_id = uid)))
  then raise exception 'duel_exists'; end if;
  if (select count(*) from public.duels where challenger_id = uid and created_at > now() - interval '1 day') >= 10
  then raise exception 'too_many'; end if;

  select coalesce(array_agg(id), '{}') into ids from (
    select q.id from public.questions q
    where q.status = 'published' and q.type = 'mcq' and q.subject_id = p_subject
      and (cardinality(p_lessons) = 0 or q.lesson_id = any (p_lessons))
    order by random() limit p_count
  ) pick;
  n := coalesce(cardinality(ids), 0);
  if n < 5 then raise exception 'not_enough_questions'; end if;

  insert into public.duels (cohort_id, challenger_id, opponent_id, subject_id, lesson_ids, question_ids)
  values (public.my_cohort(), uid, p_opponent, p_subject, p_lessons, ids)
  returning id into new_id;
  insert into public.duel_players (duel_id, user_id) values (new_id, uid), (new_id, p_opponent);
  return new_id;
end $$;

-- ───────────────────────── أسئلتي في التحدي (بلا الإجابة الصحيحة) ─────────────────────────
-- أول استدعاء للاعب يبدأ ساعته. الخصم لا يقدر على الجلوس قبل أن يفتح المتحدّي التحدي.
create or replace function public.duel_questions(p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d public.duels;
  me public.duel_players;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.duel_sweep();
  select * into d from public.duels where id = p_duel and uid in (challenger_id, opponent_id);
  if not found then raise exception 'duel_not_found'; end if;
  if uid = d.challenger_id and d.status not in ('challenger_turn', 'open') then raise exception 'duel_not_playable'; end if;
  if uid = d.opponent_id and d.status <> 'open' then raise exception 'duel_not_playable'; end if;

  select * into me from public.duel_players where duel_id = d.id and user_id = uid for update;
  if me.finished_at is not null then raise exception 'already_finished'; end if;
  if me.started_at is null then
    update public.duel_players set started_at = now() where duel_id = d.id and user_id = uid;
  end if;

  return jsonb_build_object(
    'duel_id', d.id,
    'answered', me.answered,
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'statement', q.statement, 'options', q.options,
                                          'difficulty', q.difficulty,
                                          'done', exists (select 1 from public.duel_answers a
                                                          where a.duel_id = d.id and a.user_id = uid and a.question_id = q.id))
                       order by t.ord)
      from unnest(d.question_ids) with ordinality as t(qid, ord)
      join public.questions q on q.id = t.qid
    ), '[]'::jsonb));
end $$;

-- ───────────────────────── تسجيل إجابة (بلا كشف النتيجة) ─────────────────────────
create or replace function public.duel_answer(p_duel uuid, p_question uuid, p_selected integer)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d public.duels;
  me public.duel_players;
  q public.questions;
  last_t timestamptz;
  elapsed integer;
  ok boolean;
  base smallint;
  pts numeric(5, 2) := 0;
  factor numeric;
  finished boolean := false;
  other public.duel_players;
  w uuid;
  draw boolean := false;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  select * into d from public.duels where id = p_duel and uid in (challenger_id, opponent_id) for update;
  if not found then raise exception 'duel_not_found'; end if;
  if not (p_question = any (d.question_ids)) then raise exception 'question_not_in_duel'; end if;
  if d.status = 'challenger_turn' and uid <> d.challenger_id then raise exception 'duel_not_playable'; end if;
  if d.status = 'open' and d.expires_at <= now() then perform public.duel_sweep(); raise exception 'duel_expired'; end if;
  if d.status not in ('challenger_turn', 'open') then raise exception 'duel_not_playable'; end if;

  select * into me from public.duel_players where duel_id = d.id and user_id = uid for update;
  if me.finished_at is not null then raise exception 'already_finished'; end if;
  if me.started_at is null then raise exception 'not_started'; end if;
  if exists (select 1 from public.duel_answers where duel_id = d.id and user_id = uid and question_id = p_question)
  then return jsonb_build_object('ok', true, 'repeat', true, 'finished', false); end if;

  select * into q from public.questions where id = p_question;
  if not found then raise exception 'question_not_found'; end if;
  if p_selected is null or p_selected < 0 or p_selected >= jsonb_array_length(q.options) then raise exception 'bad_answer'; end if;
  ok := (p_selected = q.correct_index);

  select max(answered_at) into last_t from public.duel_answers where duel_id = d.id and user_id = uid;
  elapsed := greatest(0, (extract(epoch from (now() - coalesce(last_t, me.started_at))) * 1000)::integer);
  -- لا يُحتسب انقطاع طويل (إغلاق التطبيق) أكثر من دقيقتين للسؤال الواحد
  elapsed := least(elapsed, 120000);

  base := public.base_points(q.difficulty);
  if ok then
    factor := greatest(0, 1 - (elapsed / 1000.0) / public.reference_seconds(q.difficulty));
    pts := base + round(base * 0.5 * factor, 2);
  end if;

  insert into public.duel_answers (duel_id, user_id, question_id, selected_index, is_correct, points, elapsed_ms)
  values (d.id, uid, q.id, p_selected, ok, pts, elapsed);

  update public.duel_players
    set answered = answered + 1, correct = correct + (case when ok then 1 else 0 end),
        points = points + pts, total_ms = total_ms + elapsed
    where duel_id = d.id and user_id = uid
    returning answered >= cardinality(d.question_ids) into finished;

  if finished then
    update public.duel_players set finished_at = now() where duel_id = d.id and user_id = uid;
    if uid = d.challenger_id then
      update public.duels set status = 'open', opened_at = now(), expires_at = now() + interval '48 hours'
        where id = d.id;
    else
      select * into me from public.duel_players where duel_id = d.id and user_id = uid;
      select * into other from public.duel_players where duel_id = d.id and user_id = d.challenger_id;
      if me.points > other.points or (me.points = other.points and me.correct > other.correct)
         or (me.points = other.points and me.correct = other.correct and me.total_ms < other.total_ms) then
        w := uid;
      elsif me.points = other.points and me.correct = other.correct and me.total_ms = other.total_ms then
        draw := true;
      else
        w := d.challenger_id;
      end if;
      update public.duels set status = 'completed', winner_id = w, is_draw = draw, completed_at = now()
        where id = d.id;
    end if;
  end if;

  -- عمداً: لا نُرجع صحة الإجابة ولا النقاط
  return jsonb_build_object('ok', true, 'repeat', false, 'finished', finished);
end $$;

-- ───────────────────────── قائمة تحدياتي ─────────────────────────
create or replace function public.my_duels() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.duel_sweep();
  return coalesce((
    select jsonb_agg(row order by (row->>'created_at') desc) from (
      select jsonb_build_object(
        'id', d.id, 'status', d.status, 'created_at', d.created_at, 'expires_at', d.expires_at,
        'subject_id', d.subject_id, 'total', cardinality(d.question_ids),
        'i_am_challenger', d.challenger_id = uid,
        'opponent_id', case when d.challenger_id = uid then d.opponent_id else d.challenger_id end,
        'opponent_name', (select full_name from public.profiles p
                          where p.id = case when d.challenger_id = uid then d.opponent_id else d.challenger_id end),
        'my_finished', me.finished_at is not null,
        'my_answered', me.answered,
        -- النتيجة لا تظهر إلا بعد اكتمال التحدي أو انتهاء مهلته
        'result', case when d.status in ('completed', 'expired') then
            jsonb_build_object('won', d.winner_id = uid, 'draw', d.is_draw) else null end
      ) as row
      from public.duels d
      join public.duel_players me on me.duel_id = d.id and me.user_id = uid
      where uid in (d.challenger_id, d.opponent_id) and d.status <> 'cancelled'
      order by d.created_at desc limit 40
    ) x
  ), '[]'::jsonb);
end $$;

-- ───────────────────────── نتيجة التحدي (بعد اكتماله فقط) ─────────────────────────
create or replace function public.duel_result(p_duel uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d public.duels;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  perform public.duel_sweep();
  select * into d from public.duels where id = p_duel and uid in (challenger_id, opponent_id);
  if not found then raise exception 'duel_not_found'; end if;
  if d.status not in ('completed', 'expired') then
    return jsonb_build_object('status', d.status, 'expires_at', d.expires_at,
      'i_am_challenger', d.challenger_id = uid,
      'my_finished', (select finished_at is not null from public.duel_players where duel_id = d.id and user_id = uid));
  end if;
  return jsonb_build_object(
    'status', d.status, 'expires_at', d.expires_at, 'i_am_challenger', d.challenger_id = uid,
    'winner_id', d.winner_id, 'is_draw', d.is_draw, 'me', uid,
    'players', (select jsonb_agg(jsonb_build_object(
        'user_id', pl.user_id, 'name', pr.full_name, 'finished', pl.finished_at is not null,
        'answered', pl.answered, 'correct', pl.correct, 'points', pl.points, 'total_ms', pl.total_ms))
      from public.duel_players pl join public.profiles pr on pr.id = pl.user_id where pl.duel_id = d.id),
    -- الإجابات الصحيحة والشرح يظهران الآن فقط (انتهى الطرفان أو المهلة)
    'questions', (select jsonb_agg(jsonb_build_object(
        'id', q.id, 'statement', q.statement, 'options', q.options, 'correct_index', q.correct_index,
        'explanation', q.explanation,
        'answers', (select jsonb_agg(jsonb_build_object('user_id', a.user_id, 'selected_index', a.selected_index,
                                                       'is_correct', a.is_correct, 'elapsed_ms', a.elapsed_ms))
                    from public.duel_answers a where a.duel_id = d.id and a.question_id = q.id)
      ) order by t.ord)
      from unnest(d.question_ids) with ordinality as t(qid, ord) join public.questions q on q.id = t.qid));
end $$;

-- ───────────────────────── السجل (انتصارات/هزائم) ─────────────────────────
-- مستقل عن الترتيب. يعدّ completed وexpired (انتهاء المهلة فوز للمتحدّي). المخفيّون من الترتيب لا يظهرون للآخرين.
create or replace function public.duel_record() returns table(user_id uuid, full_name text, wins integer, losses integer, draws integer, is_me boolean)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  return query
  select p.id, p.full_name,
         count(d.id) filter (where d.winner_id = p.id)::integer,
         count(d.id) filter (where d.winner_id is not null and d.winner_id <> p.id)::integer,
         count(d.id) filter (where d.is_draw)::integer,
         p.id = uid
  from public.profiles p
  left join public.duels d
    on d.status in ('completed', 'expired') and p.id in (d.challenger_id, d.opponent_id)
  where p.cohort_id = public.my_cohort() and (p.id = uid or not p.hide_from_ranking or public.is_admin())
  group by p.id, p.full_name
  order by 3 desc, 4 asc, p.full_name;
end $$;

-- زملاء الدفعة لاختيار الخصم (الاسم فقط)
create or replace function public.cohort_mates() returns table(id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name from public.profiles p
  where p.cohort_id = public.my_cohort() and p.id <> auth.uid() and p.role = 'student'
  order by p.full_name
$$;

revoke all on function public.duel_sweep() from public, anon;
revoke all on function public.create_duel(uuid, uuid, uuid[], integer) from public, anon;
revoke all on function public.duel_questions(uuid) from public, anon;
revoke all on function public.duel_answer(uuid, uuid, integer) from public, anon;
revoke all on function public.my_duels() from public, anon;
revoke all on function public.duel_result(uuid) from public, anon;
revoke all on function public.duel_record() from public, anon;
revoke all on function public.cohort_mates() from public, anon;
grant execute on function public.duel_sweep(), public.create_duel(uuid, uuid, uuid[], integer),
  public.duel_questions(uuid), public.duel_answer(uuid, uuid, integer), public.my_duels(),
  public.duel_result(uuid), public.duel_record(), public.cohort_mates() to authenticated, service_role;
