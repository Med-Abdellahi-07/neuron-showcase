-- 0026: remove the 15MB limit on lesson files (it came from 0020). Safe to re-run.
-- Note: the Supabase project still has a global limit (50MB on the free plan), set in Dashboard -> Storage -> Settings.
drop trigger if exists lesson_files_size_guard_trg on public.lesson_files;
drop function if exists public.lesson_files_size_guard();

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = null where id = 'lesson-files';
  end if;
end $$;
