-- 0026: إلغاء حد 15MB لملفات الحصص (كان من 0020). آمن لإعادة التشغيل.
-- ملاحظة: لا يزال لمشروع Supabase حد عام (50MB في الخطة المجانية) يُضبط من Dashboard ← Storage ← Settings.
drop trigger if exists lesson_files_size_guard_trg on public.lesson_files;
drop function if exists public.lesson_files_size_guard();

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = null where id = 'lesson-files';
  end if;
end $$;
