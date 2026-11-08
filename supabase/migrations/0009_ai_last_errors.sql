-- Latest failure reason per AI provider (shown to the admin on the test page; Vercel memory is not shared between instances)
create table if not exists public.ai_last_error (
  provider text primary key check (provider in ('gemini','groq')),
  status integer not null,
  reason text,
  message text,
  at timestamptz not null default now()
);
alter table public.ai_last_error enable row level security;
revoke all on public.ai_last_error from anon, authenticated;

create or replace function public.ai_note_error(p_provider text, p_status integer, p_reason text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_provider not in ('gemini','groq') then return; end if;
  insert into public.ai_last_error(provider, status, reason, message, at)
  values (p_provider, p_status, left(p_reason, 200), left(p_message, 600), now())
  on conflict (provider) do update
    set status = excluded.status, reason = excluded.reason, message = excluded.message, at = excluded.at;
end $$;

create or replace function public.ai_last_errors()
returns table(provider text, status integer, reason text, message text, at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query select e.provider, e.status, e.reason, e.message, e.at from public.ai_last_error e order by e.at desc;
end $$;

revoke all on function public.ai_note_error(text, integer, text, text) from public, anon;
revoke all on function public.ai_last_errors() from public, anon;
grant execute on function public.ai_note_error(text, integer, text, text) to authenticated;
grant execute on function public.ai_last_errors() to authenticated;
