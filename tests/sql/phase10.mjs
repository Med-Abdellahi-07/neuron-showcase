// الدفعة ج: المواد المتبقية من L1 (القيود والعزل) + حد PDF واستهلاك التخزين
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import fs from "node:fs";
const M = new URL("../../supabase/migrations/", import.meta.url).pathname;
const db = new PGlite({ extensions: { vector } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage; create function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid); alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated, service_role; grant all on all tables in schema storage to authenticated;
`);
const files = fs.readdirSync(M).filter((f) => f.endsWith(".sql")).sort();
const run = async (list, twice = true) => { for (const f of list) { await db.exec(fs.readFileSync(M + f, "utf8")); if (twice && !/0001|0002|0003/.test(f)) await db.exec(fs.readFileSync(M + f, "utf8")); } };

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); };
async function as(user, role, fn) {
  await db.exec("begin"); await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  try { const r = await fn(); await db.exec("commit"); return r; } catch (e) { await db.exec("rollback"); throw e; }
}
const q = (u, sql, p = []) => as(u, "authenticated", async () => (await db.query(sql, p)).rows);
const anon = (sql, p = []) => as(null, "anon", async () => (await db.query(sql, p)).rows);
const svc = (sql, p = []) => as(null, "service_role", async () => (await db.query(sql, p)).rows);
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const denied = (m) => /permission denied|row-level security|forbidden|not_authenticated|غير مسموح/.test(m ?? "");
const has = (m, w) => (m ?? "").includes(w);
const n = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].c);
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];

await run(files);
const mkUser = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const mkP = async (name, role, cohort) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const space = async (maj, lvl) => (await one("select c.id from public.cohorts c join public.majors m on m.id=c.major_id where m.code=$1 and c.level_code=$2", [maj, lvl])).id;
const SDS1 = await space("SDS", "L1"), SDS2 = await space("SDS", "L2"), DSI1 = await space("DSI", "L1"), IAA = await space("IAA", "L2");
const ADM = await mkP("ADM", "admin", IAA);
const SA1 = await mkP("SA1", "space_admin", SDS1), SA2 = await mkP("SA2", "space_admin", SDS2), SAD = await mkP("SAD", "space_admin", DSI1);
const S2a = await mkP("s2a", "student", SDS2), S2b = await mkP("s2b", "student", SDS2), S1a = await mkP("s1a", "student", SDS1), IA = await mkP("ia", "student", IAA);
const MOD = await mkP("mod", "moderator", SDS2);
const mkSub = async (coh, code) => { const sem = (await one("select id from public.semesters where cohort_id=$1 and is_current", [coh])).id; return (await one("insert into public.subjects (semester_id, code, name) values ($1,$2,$2) returning id", [sem, code])).id; };
const subA = await mkSub(SDS1, "STA1"), subB = await mkSub(SDS1, "STB1"), subD = await mkSub(DSI1, "DSA1"), sub2 = await mkSub(SDS2, "STA2");
const mkLesson = async (sub, n, status, by) => (await one("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',$2,'T',$3,$4) returning id", [sub, n, status, by])).id;
const lessonPub = await mkLesson(subA, 1, "published", SA1), lessonDraft = await mkLesson(subA, 2, "draft", SA1), lessonB = await mkLesson(subB, 1, "published", SA1);
const mkQ = async (sub, type, status = "published") => (await one(`insert into public.questions (subject_id, type, difficulty, statement, options, correct_index, model_answer, status, created_by) values ($1,$2,'easy','S',$3,0,$4,$5,$6) returning id`, [sub, type, type === "mcq" ? '["a","b"]' : null, type === "written" ? "m" : null, status, SA1])).id;
for (let i = 0; i < 6; i++) await mkQ(subA, "mcq");
await db.query(`update public.cohorts set features = features || '{"written":true}' where id=$1`, [SDS1]); // لإدراج سؤال مكتوب ثم إعادة القفل
const qWritten = await mkQ(subA, "written"), qB = await mkQ(subB, "mcq");
await db.query(`update public.cohorts set features = features || '{"written":false}' where id=$1`, [SDS1]);
await db.query("insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-11-02',1,$2,'cm'), ($1,'2026-11-02',2,$3,'cm')", [SDS1, subA, subB]);
await db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','a.pdf',$2,5000000)", [lessonPub, `${lessonPub}/a.pdf`]);
await svc("insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${lessonPub}/a.pdf`]).catch(() => db.query("insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${lessonPub}/a.pdf`]));
const add = (u, st, sj) => q(u, "insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [st, sj]);

// ══════════ القيود ══════════
ok("مشرف SDS L2 يضيف مادة SDS L1 لطالب من فضائه", (await err(add(SA2, S2a, subA))) === null);
ok("رفض: مادة من تخصص آخر (DSI L1)", has(await err(add(SA2, S2b, subD)), "subject_not_same_major_l1"));
ok("رفض: مادة من L2 نفسه (ليست L1)", has(await err(add(SA2, S2b, sub2)), "subject_not_same_major_l1"));
ok("رفض: طالب L1 لا يتابع مادة L1 (من L1 إلى L1)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S1a, subB])), "student_not_l2"));
ok("رفض: القيد يسري حتى على service role (طالب L1)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S1a, subA])), "student_not_l2"));
ok("رفض: غير الطالب (مشرف) لا يُضاف له", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [MOD, subA])), "not_a_student"));
ok("رفض: مشرف L1 لا يضيف (خارج فضاء الطالب)", denied(await err(add(SA1, S2b, subA))));
ok("رفض: طالب لا يضيف لنفسه", denied(await err(add(S2b, S2b, subA))));
ok("رفض: مشرف تخصص آخر لا يضيف", denied(await err(add(SAD, S2b, subA))));
ok("رفض: طالب IAA L2 ← مادة SDS L1 (تخصص آخر)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [IA, subA])), "subject_not_same_major_l1"));
ok("تعديل الصف ممنوع (لا update)", denied(await err(q(SA2, "update public.remaining_subjects set subject_id=$2 where student_id=$1", [S2a, subB]))));

// ══════════ ما يراه الطالب ══════════
const subs = (await q(S2a, "select code from public.subjects order by code")).map((r) => r.code);
ok("الطالب يرى مادته المتبقية فقط (لا STB1 ولا DSA1)", subs.includes("STA1") && !subs.includes("STB1") && !subs.includes("DSA1") && subs.includes("STA2"), subs.join());
const ls = (await q(S2a, "select id from public.lessons")).map((r) => r.id);
ok("يرى الدرس المنشور للمادة المتبقية، لا المسودة ولا دروس المواد الأخرى", ls.includes(lessonPub) && !ls.includes(lessonDraft) && !ls.includes(lessonB));
ok("يرى ملف الدرس المنشور", (await q(S2a, "select id from public.lesson_files where lesson_id=$1", [lessonPub])).length === 1);
ok("طالب لا يتابع لا يرى شيئاً من L1", (await q(S2b, "select id from public.lessons where subject_id=$1", [subA])).length === 0 && (await q(S2b, "select id from public.subjects where code='STA1'")).length === 0);
const qs = (await q(S2a, "select id, type from public.questions where subject_id=$1", [subA]));
ok("الأسئلة: QCM فقط (6) والمكتوب مخفي (خطة L1 أساسية)", qs.length === 6 && qs.every((x) => x.type === "mcq"));
ok("لا يقرأ correct_index", denied(await err(q(S2a, "select correct_index from public.questions"))));
ok("الجدول: حصص المادة المتبقية فقط", (await q(S2a, "select subject_id from public.schedule_sessions where cohort_id=$1", [SDS1])).map((r) => r.subject_id).join() === subA);
ok("الملف في Storage مقروء للمتابع فقط", (await q(S2a, "select name from storage.objects where bucket_id='lesson-files'")).length === 1 && (await q(S2b, "select name from storage.objects where bucket_id='lesson-files'")).length === 0);
ok("«درستُها» يعمل على درس متبقٍ", (await err(q(S2a, "insert into public.lesson_progress (user_id, lesson_id) values ($1,$2)", [S2a, lessonPub]))) === null);

// ══════════ التدريب QCM ══════════
const att = (await q(S2a, "select public.start_attempt('free',$1) as id", [subA]))[0].id;
const aq = (await db.query("select question_ids from public.attempts where id=$1", [att])).rows[0].question_ids;
ok("تدريب حر على المادة المتبقية يعمل ويضم QCM فقط", aq.length > 0 && !aq.includes(qWritten));
ok("تدريب على مادة L1 غير متبعة ← no_questions", has(await err(q(S2a, "select public.start_attempt('free',$1)", [subB])), "no_questions"));
ok("الاختبار المصنّف لا يشمل المتبقية (خطة L2 أساسية → مقفول)", has(await err(q(S2a, "select public.start_attempt('ranked')")), "feature_disabled"));

// ══════════ مشرف L1 ══════════
const fol = await q(SA1, "select * from public.l1_followers()");
ok("مشرف L1 يرى متابعيه: s2a في STA1", fol.length === 1 && fol[0].student_name === "s2a" && fol[0].subject_code === "STA1" && fol[0].student_space === "SDS L2");
ok("القائمة بلا بريد/هاتف", !/email|phone/.test(Object.keys(fol[0]).join()));
ok("مشرف L1 لا يقرأ جدول remaining_subjects", (await q(SA1, "select * from public.remaining_subjects")).length === 0);
ok("مشرف L1 لا يحذف المتابعة", ((await q(SA1, "delete from public.remaining_subjects returning 1")).length) === 0);
ok("طالب لا يستدعي l1_followers", has(await err(q(S2a, "select * from public.l1_followers()")), "forbidden"));
ok("مشرف تخصص آخر لا يرى متابعي SDS", (await q(SAD, "select * from public.l1_followers()")).length === 0);

// ══════════ الإزالة والانتقال ══════════
ok("مشرف L2 يرى مواد طلابه المتبقية", (await q(SA2, "select * from public.remaining_subjects")).length === 1);
await q(SA2, "delete from public.remaining_subjects where student_id=$1", [S2a]);
ok("بعد الإزالة: المحتوى يختفي فوراً", (await q(S2a, "select id from public.lessons where id=$1", [lessonPub])).length === 0 && (await q(S2a, "select id from public.subjects where code='STA1'")).length === 0);
await q(SA2, "insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S2a, subA]);
await db.query("update public.profiles set cohort_id=$1 where id=$2", [IAA, S2a]);
ok("انتقال الطالب لفضاء آخر يُسقط مواده المتبقية", (await n("select count(*) c from public.remaining_subjects where student_id=$1", [S2a])) === 0);

// ══════════ حد PDF والتخزين ══════════
ok("لا حد لحجم الملف في الجدول (PDF 200MB مقبول)", !(await err(db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','big.pdf',$2,209715200)", [lessonB, `${lessonB}/big.pdf`]))));
await db.query("delete from public.lesson_files where name='big.pdf'");
ok("PDF بحجم 15MB مقبول", !(await err(db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','ok.pdf',$2,15728640)", [lessonB, `${lessonB}/ok.pdf`]))));
ok("الدلو بلا حد حجم", (await one("select file_size_limit from storage.buckets where id='lesson-files'")).file_size_limit === null);
const su = (await q(ADM, "select public.storage_usage() as d"))[0].d;
const sds1 = su.by_space.find((s) => s.name === "SDS L1");
ok("استهلاك التخزين: الإجمالي = مجموع الأحجام", Number(su.total_bytes) === 5000000 + 15728640 && su.files === 2, JSON.stringify(su));
ok("استهلاك كل فضاء: SDS L1 يحمل كل الملفات", Number(sds1.bytes) === Number(su.total_bytes) && su.by_space.length === 1);
ok("storage_usage للمشرف العام فقط", has(await err(q(SA1, "select public.storage_usage()")), "forbidden") && has(await err(q(S2b, "select public.storage_usage()")), "forbidden") && denied(await err(anon("select public.storage_usage()"))));

console.log(`\n${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
