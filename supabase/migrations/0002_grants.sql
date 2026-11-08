-- Neuron - table privileges for roles.
-- Required when "Automatically expose new tables" is disabled in Supabase.
-- The real access guard remains the RLS policies; these grants only let the role reach the table at all.
-- Run once before 0003. Never re-run it after 0003: its blanket select grant would undo the column restrictions on the questions table.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- For tables and functions created later (in future migration files)
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
