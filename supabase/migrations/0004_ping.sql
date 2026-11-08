-- Neuron - ping function for the keep-alive job (GitHub Actions).
-- Run from the SQL Editor. Safe to run more than once.
--
-- Why a function? An anonymous request to a table is sometimes rejected by PostgREST before touching the database,
-- whereas calling a function runs a real query in Postgres. This function reads no table and exposes only the time.

create or replace function public.ping() returns timestamptz
language sql stable
as $$ select now() $$;

-- anon (the public key) can execute this function only, and nothing else
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated, service_role;
