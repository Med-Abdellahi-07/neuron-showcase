-- 0028: ملفات كبيرة مجزّأة. الملف >45MB يُقسَم في المتصفح إلى أجزاء ≤45MB تحت
-- <lessonId>/<fileId>/part-001 … ويبقى «ملفاً واحداً» في lesson_files (storage_path = <lessonId>/<fileId>).
-- لا حد لحجم الملف الواحد؛ حد الدلو = 50MB (أقصى ما تسمح به خطة Supabase المجانية لكل كائن).
-- آمن لإعادة التشغيل.

alter table public.lesson_files add column if not exists part_count smallint not null default 1 check (part_count >= 1);
alter table public.lesson_files add column if not exists sha256 text;                 -- sha256 لتسلسل بصمات الأجزاء (مجزّأ فقط)
alter table public.lesson_files add column if not exists part_sha256 text[];          -- بصمة كل جزء (للتحقق عند الضم)
alter table public.lesson_files drop constraint if exists lesson_files_parts_chk;
alter table public.lesson_files add constraint lesson_files_parts_chk
  check (part_count = 1 or (part_sha256 is not null and cardinality(part_sha256) = part_count and sha256 is not null));

do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets set file_size_limit = 52428800 where id = 'lesson-files';
  end if;
end $$;

-- القراءة: قاعدة 0020 نفسها (فضاء المستخدم + منشور للطالب + متابعو مواد L1) لكن تشمل أجزاء الملف المجزّأ
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
