-- 0023: دردشة جماعية عامة لكل فضاء (بعد 0022، idempotent).
-- • غرفة واحدة لكل فضاء، لا يراها إلا أعضاؤه (الحصر عبر my_cohort() داخل الدوال؛ الجدول مغلق على المتصفح).
-- • الطالب يحذف رسائله هو؛ طاقم الفضاء (مشرف/مشرف فضاء/مشرف عام داخل فضائه) يحذف أي رسالة ويكتم المسيء.
-- • ميزة «chat» قابلة للتفعيل لكل فضاء من /admin/spaces؛ تُفعَّل الآن في الفضاءات ذات الخطة full فقط.
-- • حدّ إرسال: 12 رسالة/دقيقة و300/يوم لكل طالب. النص 1..1000 حرف.

-- ───────────────────────── 1) الميزة ─────────────────────────
update public.plans set features = features || '{"chat":true}'::jsonb where code = 'full' and not (features ? 'chat');
update public.plans set features = features || '{"chat":false}'::jsonb where code = 'basic' and not (features ? 'chat');
update public.cohorts set features = features || '{"chat":true}'::jsonb where plan = 'full' and not (features ? 'chat');

-- ───────────────────────── 2) الجداول (مغلقة على المتصفح) ─────────────────────────
create table if not exists public.space_messages (
  id bigint generated always as identity primary key,
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  reply_to bigint references public.space_messages(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists space_messages_room_idx on public.space_messages (cohort_id, id desc);
create index if not exists space_messages_user_idx on public.space_messages (user_id, created_at desc);

create table if not exists public.space_mutes (
  cohort_id uuid not null references public.cohorts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  until timestamptz not null,
  muted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (cohort_id, user_id)
);

alter table public.space_messages enable row level security;
alter table public.space_mutes enable row level security;
revoke all on public.space_messages, public.space_mutes from anon, authenticated;
grant all on public.space_messages, public.space_mutes to service_role;

-- ───────────────────────── 3) الدوال ─────────────────────────
-- قراءة: p_after = الجديد بعد معرّف (للتحديث الدوري)، p_before = الأقدم قبل معرّف، وإلا آخر p_limit رسالة. الترتيب تصاعدي.
create or replace function public.space_chat_list(p_after bigint default null, p_before bigint default null, p_limit integer default 40)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid := public.my_cohort();
  lim integer := least(greatest(coalesce(p_limit, 40), 1), 100);
  msgs jsonb;
  mu timestamptz;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if coh is null then raise exception 'no_space'; end if;
  if not public.cohort_feature(coh, 'chat') then raise exception 'feature_disabled'; end if;

  select coalesce(jsonb_agg(x.j order by x.id), '[]'::jsonb) into msgs
  from (
    select m.id, jsonb_build_object(
             'id', m.id,
             'user_id', m.user_id,
             'name', coalesce(nullif(p.full_name, ''), '—'),
             'staff', p.role in ('moderator', 'space_admin', 'admin'),
             'body', m.body,
             'reply_to', m.reply_to,
             'created_at', m.created_at,
             'mine', m.user_id = uid
           ) as j
    from public.space_messages m
    join public.profiles p on p.id = m.user_id
    where m.cohort_id = coh
      and (p_after is null or m.id > p_after)
      and (p_before is null or m.id < p_before)
    order by case when p_after is null then m.id end desc, case when p_after is not null then m.id end asc
    limit lim
  ) x;

  select until into mu from public.space_mutes where cohort_id = coh and user_id = uid and until > now();
  return jsonb_build_object('messages', msgs, 'muted_until', mu, 'staff', public.is_staff());
end $$;

create or replace function public.space_chat_send(p_body text, p_reply bigint default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid := public.my_cohort();
  b text := btrim(coalesce(p_body, ''));
  nid bigint;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if coh is null then raise exception 'no_space'; end if;
  if not public.cohort_feature(coh, 'chat') then raise exception 'feature_disabled'; end if;
  if char_length(b) < 1 or char_length(b) > 1000 then raise exception 'bad_body'; end if;
  if exists (select 1 from public.space_mutes where cohort_id = coh and user_id = uid and until > now()) then
    raise exception 'muted';
  end if;
  perform pg_advisory_xact_lock(hashtext('space_chat:' || uid::text));
  if (select count(*) from public.space_messages where user_id = uid and created_at > now() - interval '1 minute') >= 12
     or (select count(*) from public.space_messages where user_id = uid and created_at > now() - interval '1 day') >= 300 then
    raise exception 'rate_limited';
  end if;
  if p_reply is not null and not exists (select 1 from public.space_messages where id = p_reply and cohort_id = coh) then
    p_reply := null;
  end if;
  insert into public.space_messages (cohort_id, user_id, body, reply_to) values (coh, uid, b, p_reply) returning id into nid;
  return nid;
end $$;

-- حذف: صاحب الرسالة، أو طاقم الفضاء نفسه
create or replace function public.space_chat_delete(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid := public.my_cohort();
  n integer;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if coh is null then raise exception 'no_space'; end if;
  delete from public.space_messages m
   where m.id = p_id and m.cohort_id = coh and (m.user_id = uid or public.is_staff());
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- كتم عضو لعدد ساعات (0 = رفع الكتم). للطاقم فقط، داخل فضائه، ولا يُكتم الطاقم.
create or replace function public.space_chat_mute(p_user uuid, p_hours integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  coh uuid := public.my_cohort();
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if not public.is_staff() then raise exception 'forbidden'; end if;
  if coh is null then raise exception 'no_space'; end if;
  if not exists (select 1 from public.profiles where id = p_user and cohort_id = coh and role = 'student') then
    raise exception 'bad_target';
  end if;
  if coalesce(p_hours, 0) <= 0 then
    delete from public.space_mutes where cohort_id = coh and user_id = p_user;
    return true;
  end if;
  insert into public.space_mutes (cohort_id, user_id, until, muted_by)
    values (coh, p_user, now() + make_interval(hours => least(p_hours, 720)), uid)
  on conflict (cohort_id, user_id) do update set until = excluded.until, muted_by = excluded.muted_by, created_at = now();
  return true;
end $$;

revoke all on function public.space_chat_list(bigint, bigint, integer) from public, anon;
revoke all on function public.space_chat_send(text, bigint) from public, anon;
revoke all on function public.space_chat_delete(bigint) from public, anon;
revoke all on function public.space_chat_mute(uuid, integer) from public, anon;
grant execute on function public.space_chat_list(bigint, bigint, integer), public.space_chat_send(text, bigint),
  public.space_chat_delete(bigint), public.space_chat_mute(uuid, integer) to authenticated, service_role;
