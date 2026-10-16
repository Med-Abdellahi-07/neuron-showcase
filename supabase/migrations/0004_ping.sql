-- Neuron — دالة ping لمهمة keep-alive (GitHub Actions).
-- تُنفَّذ من SQL Editor. آمنة للتنفيذ أكثر من مرة.
--
-- لماذا دالة؟ الطلب المجهول إلى جدول يُرفض عند PostgREST قبل لمس قاعدة البيانات أحياناً،
-- أما استدعاء دالة فينفّذ استعلاماً فعلياً في Postgres. الدالة لا تقرأ أي جدول ولا تكشف إلا الوقت.

create or replace function public.ping() returns timestamptz
language sql stable
as $$ select now() $$;

-- anon (المفتاح العام) يستطيع تنفيذ هذه الدالة فقط، ولا شيء غيرها
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated, service_role;
