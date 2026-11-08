-- 0028: large multipart files. A file over 45MB is split in the browser into parts of at most 45MB under
-- <lessonId>/<fileId>/part-001 ... and stays "one file" in lesson_files (storage_path = <lessonId>/<fileId>).
-- No limit on a single file's size; the bucket limit is 50MB (the most the free Supabase plan allows per object).
-- Safe to re-run.

alter table public.lesson_files add column if not exists part_count smallint not null default 1 check (part_count >= 1);
alter table public.lesson_files add column if not exists sha256 text; -- sha256 over the concatenated part hashes (multipart only)
alter table public.lesson_files add column if not exists part_sha256 text[]; -- hash of each part (verified when joining)
alter table public.lesson_files drop constraint if exists lesson_files_parts_chk;
alter table public.lesson_files add constraint lesson_files_parts_chk
  check (part_count = 1 or (part_sha256 is not null and cardinality(part_sha256) = part_count and sha256 is not null));

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 52428800 where id = 'lesson-files';
  end if;
end $$;

-- Read: the same rule as 0020 (user's space + published for students + L1 subject followers), but including the parts of a multipart file
drop policy if exists lesson_files_storage_read on storage.objects;
create policy lesson_files_storage_read on storage.objects for select to authenticated
  using (bucket_id = 'lesson-files'
         and ((public.storage_path_cohort(name) = public.my_cohort()
               and (public.is_staff() or exists (
                    select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
                    where l.status = 'published'
                      and (f.storage_path = storage.objects.name
                           or (f.part_count > 1 and storage.objects.name like f.storage_path || '/part-%')))))
              or exists (
                    select 1 from public.lesson_files f join public.lessons l on l.id = f.lesson_id
                    where l.status = 'published'
                      and (f.storage_path = storage.objects.name
                           or (f.part_count > 1 and storage.objects.name like f.storage_path || '/part-%'))
                      and public.follows_subject(l.subject_id))));
