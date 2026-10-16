-- Neuron — صلاحيات الجداول للأدوار.
-- مطلوبة عند تعطيل "Automatically expose new tables" في Supabase.
-- حارس الوصول الفعلي يبقى سياسات RLS؛ هذه الصلاحيات فقط تسمح للدور بالوصول إلى الجدول أصلاً.
-- آمنة للتنفيذ أكثر من مرة.

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to authenticated, service_role;

-- للجداول والدوال التي ستُنشأ لاحقاً (في ملفات migration القادمة)
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
