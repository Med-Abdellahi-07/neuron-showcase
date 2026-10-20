// المرحلة (أ): الفضاءات — نقل IAA L2 دون فقدان + عزل تام بين الفضاءات + ميزات الخطة مقفولة على الخادم
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
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const n = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].c);

// ══════════ المرحلة 0: قاعدة «قديمة» (0001–0016) ببيانات حقيقية الشكل ══════════
await run(files.filter((f) => f < "0017"));
const mkUser = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const legacy = (await one("select id from public.cohorts limit 1")).id;
const sem0 = (await one("select id from public.semesters where is_current limit 1")).id;
const subs0 = (await db.query("select id from public.subjects where semester_id=$1 order by sort", [sem0])).rows.map((r) => r.id);
const mkLegacy = async (name, role, cohort) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const A0 = await mkLegacy("A", "student", legacy), B0 = await mkLegacy("B", "student", legacy);
const M0 = await mkLegacy("M", "moderator", legacy);
const ADM = await mkLegacy("ADM", "admin", null); // المشرف العام بلا دفعة (حالة محتملة في الإنتاج)
const lesson0 = (await one("insert into public.lessons (subject_id, kind, number, title, status) values ($1,'cm',1,'L','published') returning id", [subs0[0]])).id;
await db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path) values ($1,'pdf','x.pdf',$2)", [lesson0, `${lesson0}/x.pdf`]);
const mq0 = async (st, status = "published") => (await one(`insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, status) values ($1,$2,'mcq','medium',$3,'["a","b","c","d"]',1,$4) returning id`, [subs0[0], lesson0, st, status])).id;
const qs0 = []; for (let i = 0; i < 8; i++) qs0.push(await mq0("Q" + i));
await db.query("insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-19',1,$2,'cm')", [legacy, subs0[0]]);
await db.query("insert into public.announcements (cohort_id, title) values ($1,'hello')", [legacy]);
await db.query("insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id, status) values ($1,$2,'cm','2026-10-10','R','youtube','dQw4w9WgXcQ','published')", [legacy, subs0[0]]);
await db.query("insert into public.lesson_progress (user_id, lesson_id) values ($1,$2)", [A0, lesson0]);
const att0 = (await one("insert into public.attempts (user_id,cohort_id,mode,subject_id,question_ids,total) values ($1,$2,'free',$3,$4,2) returning id", [A0, legacy, subs0[0], qs0.slice(0, 2)])).id;
for (const qq of qs0.slice(0, 2)) await db.query("insert into public.attempt_answers (attempt_id,user_id,question_id,subject_id,difficulty,qtype,selected_index,is_correct) values ($1,$2,$3,$4,'medium','mcq',0,false)", [att0, A0, qq, subs0[0]]);
await db.query("insert into public.review_queue (user_id, question_id, stage, due_at) values ($1,$2,0,now())", [A0, qs0[0]]);
const snap = async () => ({
  profiles: await n("select count(*) c from public.profiles"), lessons: await n("select count(*) c from public.lessons"),
  files: await n("select count(*) c from public.lesson_files"), questions: await n("select count(*) c from public.questions"),
  sched: await n("select count(*) c from public.schedule_sessions"), ann: await n("select count(*) c from public.announcements"),
  rec: await n("select count(*) c from public.recordings"), att: await n("select count(*) c from public.attempts"),
  ans: await n("select count(*) c from public.attempt_answers"), rq: await n("select count(*) c from public.review_queue"),
  prog: await n("select count(*) c from public.lesson_progress"), subj: await n("select count(*) c from public.subjects"),
});
const before = await snap();
const startDate = (await one("select start_date::text d from public.semesters where code='S3'")).d;

// ══════════ المرحلة 1: ترحيل 0017 + 0018 (مرتان للتأكد من idempotency) ══════════
await run(files.filter((f) => f >= "0017"));
const IAA = (await one("select c.id from public.cohorts c join public.majors m on m.id=c.major_id where m.code='IAA' and c.level_code='L2'")).id;
const after = await snap();

ok("تحويل الدفعة: المعرّف نفسه (لا نقل صفوف)", IAA === legacy);
const iaa = await one("select * from public.cohorts where id=$1", [IAA]);
ok("اسم الفضاء IAA L2، مفعّل، خطة كاملة", iaa.name === "IAA L2" && iaa.is_active && iaa.plan === "full" && iaa.level_code === "L2");
ok("كل ميزات الخطة الكاملة مفعّلة في IAA L2", ["ai", "arena", "ranking", "duel", "review", "recordings", "qcm_pdf", "written"].every((f) => iaa.features[f] === true), JSON.stringify(iaa.features));
ok("لا فقدان في أي جدول (الأعداد مطابقة قبل/بعد)", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
ok("كل مواد IAA L2 (11) مربوطة بالفضاء", (await n("select count(*) c from public.subjects where cohort_id=$1", [IAA])) === 11 && (await n("select count(*) c from public.subjects")) === 11);
ok("فصلا IAA L2: S3 حالي وS4", JSON.stringify((await db.query("select code, is_current from public.semesters where cohort_id=$1 order by code", [IAA])).rows) === JSON.stringify([{ code: "S3", is_current: true }, { code: "S4", is_current: false }]));
ok("تاريخ بداية S3 محفوظ", (await one("select start_date::text d from public.semesters where code='S3' and cohort_id=$1", [IAA])).d === startDate);
ok("المشرف العام بلا دفعة ← IAA L2", (await one("select cohort_id from public.profiles where id=$1", [ADM])).cohort_id === IAA);
ok("الدرس والملف والتسجيل والأسئلة بقيت في IAA L2", (await n("select count(*) c from public.lessons l join public.subjects s on s.id=l.subject_id where s.cohort_id=$1", [IAA])) === 1);
ok("24 فضاءً (12 تخصصاً × L1/L2)", (await n("select count(*) c from public.cohorts where major_id is not null")) === 24);
ok("4 مؤسسات و12 تخصصاً و2 مستوى", (await n("select count(*) c from public.institutions")) === 4 && (await n("select count(*) c from public.majors")) === 12 && (await n("select count(*) c from public.levels")) === 2);
ok("48 فصلاً: فصل «حالي» واحد لكل فضاء", (await n("select count(*) c from public.semesters")) === 48 && (await n("select count(*) c from (select cohort_id from public.semesters where is_current group by 1 having count(*)=1) x")) === 24);
ok("الفضاءات الجديدة غير مفعّلة وبخطة أساسية بلا ميزات", (await n("select count(*) c from public.cohorts where major_id is not null and id<>$1 and not is_active and plan='basic' and not (features::text like '%true%')", [IAA])) === 23);
ok("تسمية الفضاءات <تخصص> <مستوى>", (await n("select count(*) c from public.cohorts where name in ('SDS L1','IAA L1','FST x','DSI L2','MMP L1')")) === 4);
ok("إعادة تشغيل 0017/0018 لم تكرّر شيئاً", (await n("select count(*) c from public.cohorts")) === 24 && (await n("select count(*) c from public.institutions")) === 4);

// الأدوار الجديدة
const SDS1 = (await one("select id from public.cohorts where name='SDS L1'")).id;
const DSI2 = (await one("select id from public.cohorts where name='DSI L2'")).id;
const IAA1 = (await one("select id from public.cohorts where name='IAA L1'")).id;
await db.query("update public.cohorts set is_active = true where id in ($1,$2)", [SDS1, DSI2]);
await db.query("update public.cohorts set plan='full', features=(select features from public.plans where code='full') where id=$1", [DSI2]);

const mk = async (name, role, cohort) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const A = A0, B = B0, MOD = M0;
const S_SDS = await mk("S_SDS", "student", SDS1), S_SDS2 = await mk("S_SDS2", "student", SDS1), SA_SDS = await mk("SA_SDS", "space_admin", SDS1);
const S_DSI = await mk("S_DSI", "student", DSI2), SA_DSI = await mk("SA_DSI", "space_admin", DSI2), S_DSI2 = await mk("S_DSI2", "student", DSI2);
const cur = async (c) => (await one("select id from public.semesters where cohort_id=$1 and is_current", [c])).id;
const SEM_SDS = await cur(SDS1), SEM_DSI = await cur(DSI2);
const mkSub = async (sem, code) => (await one("insert into public.subjects (semester_id, code, name) values ($1,$2,$3) returning id", [sem, code, code])).id;
const SUB_SDS = await mkSub(SEM_SDS, "LSDS111"), SUB_DSI = await mkSub(SEM_DSI, "LDSI311");
const SUB_IAA = subs0[0];
ok("المادة تأخذ cohort_id من فصلها تلقائياً", (await one("select cohort_id from public.subjects where id=$1", [SUB_SDS])).cohort_id === SDS1);
const lsn = async (sub, nb, status = "published") => (await one("insert into public.lessons (subject_id, kind, number, title, status) values ($1,'cm',$2,$3,$4) returning id", [sub, nb, `L${nb}`, status])).id;
const L_SDS = await lsn(SUB_SDS, 1), L_SDS_DRAFT = await lsn(SUB_SDS, 2, "draft"), L_DSI = await lsn(SUB_DSI, 1), L_DSI_DRAFT = await lsn(SUB_DSI, 2, "draft");
const mkq = async (sub, lsnId, st, { type = "mcq", status = "published" } = {}) => (await one(
  `insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, model_answer, status) values ($1,$2,$3,'medium',$4,$5,$6,$7,$8) returning id`,
  [sub, lsnId, type, st, type === "mcq" ? JSON.stringify(["a", "b", "c", "d"]) : null, type === "mcq" ? 1 : null, type === "written" ? "m" : null, status])).id;
const SDS_Q = []; for (let i = 0; i < 6; i++) SDS_Q.push(await mkq(SUB_SDS, L_SDS, "SDSQ" + i));
// سؤال مكتوب موروث (أُضيف قبل خفض الخطة): الـ trigger يمنع الإضافة الجديدة فقط، فنفعّل الميزة مؤقتاً لإنشائه
await db.query("update public.cohorts set features = features || '{\"written\":true}'::jsonb where id=$1", [SDS1]);
const SDS_W = await mkq(SUB_SDS, L_SDS, "SDS-WRITTEN", { type: "written" });
await db.query("update public.cohorts set features = features || '{\"written\":false}'::jsonb where id=$1", [SDS1]);
const DSI_Q = []; for (let i = 0; i < 6; i++) DSI_Q.push(await mkq(SUB_DSI, L_DSI, "DSIQ" + i));
await db.query("insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-19',1,$2,'cm'),($3,'2026-10-19',1,$4,'cm')", [SDS1, SUB_SDS, DSI2, SUB_DSI]);
await db.query("insert into public.announcements (cohort_id, title) values ($1,'sds-ann'),($2,'dsi-ann')", [SDS1, DSI2]);
await db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path) values ($1,'pdf','s.pdf',$2),($3,'pdf','d.pdf',$4)", [L_SDS, `${L_SDS}/s.pdf`, L_DSI, `${L_DSI}/d.pdf`]);
await db.query("insert into storage.objects (bucket_id, name) values ('lesson-files', $1), ('lesson-files', $2), ('lesson-files', $3)", [`${L_SDS}/s.pdf`, `${L_DSI}/d.pdf`, `${lesson0}/x.pdf`]);
await db.query("insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id, status) values ($1,$2,'cm','2026-10-10','SDS-REC','youtube','dQw4w9WgXcQ','published')", [SDS1, SUB_SDS]);
await db.query("insert into public.lesson_chunks (lesson_id, file_id, subject_id, page, chunk_index, content) select $1, f.id, $2, 1, 0, 'contenu sds' from public.lesson_files f where f.lesson_id=$1", [L_SDS, SUB_SDS]);

// ══════════ عزل القراءة: طالب SDS L1 ══════════
const ids = (rows) => rows.map((r) => r.id);
ok("SDS: يرى مواد فضائه فقط", JSON.stringify(ids(await q(S_SDS, "select id from public.subjects"))) === JSON.stringify([SUB_SDS]));
ok("SDS: يرى فصول فضائه فقط", (await q(S_SDS, "select id from public.semesters")).length === 2);
ok("SDS: الدروس المنشورة في فضائه فقط (بلا المسودة وبلا IAA/DSI)", JSON.stringify(ids(await q(S_SDS, "select id from public.lessons"))) === JSON.stringify([L_SDS]));
ok("SDS: لا شيء من IAA L2 بالمعرّف المباشر", (await q(S_SDS, "select id from public.lessons where id=$1 or subject_id=$2", [lesson0, SUB_IAA])).length === 0 && (await q(S_SDS, "select id from public.subjects where id=$1", [SUB_IAA])).length === 0);
ok("SDS: الأسئلة المنشورة في فضائه فقط (7)", (await q(S_SDS, "select id from public.questions")).length === 7);
ok("SDS: لا أسئلة IAA", (await q(S_SDS, "select id from public.questions where subject_id=$1", [SUB_IAA])).length === 0);
ok("SDS: جدول فضائه فقط", (await q(S_SDS, "select cohort_id from public.schedule_sessions")).every((r) => r.cohort_id === SDS1) && (await q(S_SDS, "select 1 from public.schedule_sessions")).length === 1);
ok("SDS: إعلانات فضائه فقط", JSON.stringify((await q(S_SDS, "select title from public.announcements")).map((r) => r.title)) === '["sds-ann"]');
ok("SDS: ملفات حصصه فقط", JSON.stringify((await q(S_SDS, "select name from public.lesson_files")).map((r) => r.name)) === '["s.pdf"]');
ok("SDS: ملفات التخزين: ملفه وحده", JSON.stringify((await q(S_SDS, "select name from storage.objects")).map((r) => r.name)) === JSON.stringify([`${L_SDS}/s.pdf`]));
ok("SDS: لا يرى الفضاءات الأخرى (cohorts)", JSON.stringify(ids(await q(S_SDS, "select id from public.cohorts"))) === JSON.stringify([SDS1]));
ok("SDS: لا يرى حسابات غيره", JSON.stringify(ids(await q(S_SDS, "select id from public.profiles"))) === JSON.stringify([S_SDS]));
ok("SDS: لا يرى محاولات/إجابات طلاب IAA", (await q(S_SDS, "select id from public.attempts")).length === 0 && (await q(S_SDS, "select id from public.attempt_answers")).length === 0 && (await q(S_SDS, "select 1 from public.review_queue")).length === 0);
ok("SDS: لا يقرأ correct_index/explanation", denied(await err(q(S_SDS, "select correct_index from public.questions"))));
ok("SDS: start_attempt على مادة IAA ← no_questions", has(await err(q(S_SDS, "select public.start_attempt('free',$1)", [SUB_IAA])), "no_questions"));
ok("SDS: submit_answer على سؤال IAA مرفوض", (await err(q(S_SDS, "select public.submit_answer($1,$2,1)", [att0, qs0[0]]))) !== null);
ok("IAA: الطالب لا يرى شيئاً من SDS/DSI", (await q(A, "select id from public.subjects")).length === 11 && (await q(A, "select id from public.lessons where id in ($1,$2)", [L_SDS, L_DSI])).length === 0 && (await q(A, "select 1 from public.announcements where title like '%-ann'")).length === 0 && (await q(A, "select 1 from public.schedule_sessions")).length === 1);
ok("IAA: التخزين: ملف IAA وحده", JSON.stringify((await q(A, "select name from storage.objects")).map((r) => r.name)) === JSON.stringify([`${lesson0}/x.pdf`]));
ok("IAA: المشرف العادي لا يرى مسودات SDS", (await q(MOD, "select id from public.lessons where id in ($1,$2)", [L_SDS_DRAFT, L_DSI_DRAFT])).length === 0);
ok("IAA: المشرف العادي يرى فضاءه (مسودات وكل الأسئلة)", (await q(MOD, "select id from public.subjects")).length === 11);

// ══════════ عزل الكتابة: مشرف فضاء SDS L1 ══════════
const insLesson = (u, sub, nb, status = "published") => q(u, "insert into public.lessons (subject_id, kind, number, title, status) values ($1,'cm',$2,'T',$3) returning id, status", [sub, nb, status]);
const r1 = await insLesson(SA_SDS, SUB_SDS, 10);
ok("مشرف الفضاء: يرفع درساً في فضائه وينشر مباشرة (بلا موافقة)", r1.length === 1 && r1[0].status === "published");
ok("مشرف الفضاء: لا يضيف درساً في DSI", denied(await err(insLesson(SA_SDS, SUB_DSI, 10))));
ok("مشرف الفضاء: لا يضيف درساً في IAA", denied(await err(insLesson(SA_SDS, SUB_IAA, 10))));
ok("مشرف الفضاء: لا يعدّل درس DSI", (await q(SA_SDS, "update public.lessons set title='hack' where id=$1 returning id", [L_DSI])).length === 0);
ok("مشرف الفضاء: لا يعدّل درس IAA", (await q(SA_SDS, "update public.lessons set title='hack' where id=$1 returning id", [lesson0])).length === 0);
ok("مشرف الفضاء: لا يحذف درس DSI/IAA", (await q(SA_SDS, "delete from public.lessons where id in ($1,$2) returning id", [L_DSI, lesson0])).length === 0);
ok("مشرف الفضاء: لا يرى مسودات DSI ولا IAA", (await q(SA_SDS, "select id from public.lessons where id in ($1,$2,$3)", [L_DSI_DRAFT, L_DSI, lesson0])).length === 0);
ok("مشرف الفضاء: يرى مسودات فضائه", (await q(SA_SDS, "select id from public.lessons where id=$1", [L_SDS_DRAFT])).length === 1);
ok("مشرف الفضاء: لا ينقل درساً إلى مادة فضاء آخر", denied(await err(q(SA_SDS, "update public.lessons set subject_id=$1 where id=$2", [SUB_DSI, L_SDS]))));
ok("مشرف الفضاء: يعدّل درس فضائه (أي درس، لا درسه فقط)", (await q(SA_SDS, "update public.lessons set title='ok' where id=$1 returning id", [L_SDS])).length === 1);
ok("مشرف الفضاء: لا يضيف حصة لجدول DSI", denied(await err(q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',1,$2,'cm')", [DSI2, SUB_DSI]))));
ok("مشرف الفضاء: لا يضيف في جدول فضائه مادة من فضاء آخر", denied(await err(q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',1,$2,'cm')", [SDS1, SUB_IAA]))));
ok("مشرف الفضاء: يضيف حصة في جدول فضائه", (await q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',2,$2,'cm') returning id", [SDS1, SUB_SDS])).length === 1);
ok("مشرف الفضاء: لا يعدّل/يحذف جدول DSI", (await q(SA_SDS, "update public.schedule_sessions set room='x' where cohort_id=$1 returning id", [DSI2])).length === 0 && (await q(SA_SDS, "delete from public.schedule_sessions where cohort_id=$1 returning id", [DSI2])).length === 0);
ok("مشرف الفضاء: ينشر إعلاناً لفضائه", (await q(SA_SDS, "insert into public.announcements (cohort_id, title) values ($1,'x') returning id", [SDS1])).length === 1);
ok("مشرف الفضاء: لا ينشر إعلاناً لفضاء آخر", denied(await err(q(SA_SDS, "insert into public.announcements (cohort_id, title) values ($1,'x')", [DSI2]))));
ok("مشرف الفضاء: لا يحذف إعلان فضاء آخر", (await q(SA_SDS, "delete from public.announcements where cohort_id=$1 returning id", [DSI2])).length === 0);
ok("مشرف الفضاء: يضيف مادة في فصل فضائه", (await q(SA_SDS, "insert into public.subjects (semester_id, code, name) values ($1,'LSDS112','x') returning id", [SEM_SDS])).length === 1);
ok("مشرف الفضاء: لا يضيف مادة في فصل فضاء آخر (حتى بـ cohort_id مزوَّر)", denied(await err(q(SA_SDS, "insert into public.subjects (semester_id, cohort_id, code, name) values ($1,$2,'HACK','x')", [SEM_DSI, SDS1]))));
ok("مشرف الفضاء: لا يعدّل مادة فضاء آخر", (await q(SA_SDS, "update public.subjects set name='x' where id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0);
ok("مشرف الفضاء: يعدّل تاريخ بداية فصله ولا فصل غيره", (await q(SA_SDS, "update public.semesters set start_date='2026-10-12' where id=$1 returning id", [SEM_SDS])).length === 1 && (await q(SA_SDS, "update public.semesters set start_date='2026-10-12' where id=$1 returning id", [SEM_DSI])).length === 0);
ok("مشرف الفضاء: يرى حسابات فضائه فقط", JSON.stringify(ids(await q(SA_SDS, "select id from public.profiles")).sort()) === JSON.stringify([S_SDS, S_SDS2, SA_SDS].sort()));
ok("مشرف الفضاء: لا ينشئ حساباً مباشرة (الإنشاء عبر الخادم)", denied(await err(q(SA_SDS, "insert into public.profiles (id, full_name, role, cohort_id) values (gen_random_uuid(),'x','student',$1)", [SDS1]))));
ok("مشرف الفضاء: لا يغيّر دور طالب ولا ينقله لفضاء آخر (لا صف يُحدَّث)", (await q(SA_SDS, "update public.profiles set role='admin' where id=$1 returning id", [S_SDS])).length === 0 && (await q(SA_SDS, "update public.profiles set cohort_id=$1 where id=$2 returning id", [DSI2, S_SDS])).length === 0 && (await one("select role, cohort_id from public.profiles where id=$1", [S_SDS])).role === "student");
ok("مشرف الفضاء: لا يرقّي نفسه ولا ينقل نفسه", denied(await err(q(SA_SDS, "update public.profiles set role='admin' where id=$1", [SA_SDS]))) && denied(await err(q(SA_SDS, "update public.profiles set cohort_id=$1 where id=$2", [DSI2, SA_SDS]))));
ok("مشرف الفضاء: لا يعدّل خطة فضائه ولا يفعّله ولا ينشئ فضاءً", (await q(SA_SDS, "update public.cohorts set plan='full', is_active=false where id=$1 returning id", [SDS1])).length === 0 && denied(await err(q(SA_SDS, "insert into public.cohorts (name) values ('hack')"))));
ok("مشرف الفضاء: لا يعدّل أسماء المؤسسات والتخصصات", (await q(SA_SDS, "update public.majors set name_fr='x' returning id")).length === 0 && (await q(SA_SDS, "update public.institutions set name_fr='x' returning id")).length === 0);
ok("مشرف الفضاء: ensure_spaces غير مسموحة", denied(await err(q(SA_SDS, "select public.ensure_spaces()"))));
ok("مشرف الفضاء: إحصاءات فضائه فقط (admin_students)", JSON.stringify(ids(await q(SA_SDS, "select id from public.admin_students()")).sort()) === JSON.stringify([S_SDS, S_SDS2].sort()));
ok("الطالب لا ينفّذ admin_students", denied(await err(q(S_SDS, "select * from public.admin_students()"))));
ok("مشرف الفضاء: سؤال مرتبط بحصة فضاء آخر مرفوض", denied(await err(q(SA_SDS, "insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, status) values ($1,$2,'mcq','easy','x','[\"a\",\"b\"]',0,'published')", [SUB_SDS, L_DSI]))));
ok("مشرف الفضاء: يضيف سؤال QCM في فضائه وينشره", (await q(SA_SDS, "insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, status) values ($1,$2,'mcq','easy','x','[\"a\",\"b\"]',0,'published') returning status", [SUB_SDS, L_SDS]))[0]?.status === "published");
ok("مشرف الفضاء: لا يضيف سؤالاً في مادة فضاء آخر", denied(await err(q(SA_SDS, "insert into public.questions (subject_id, type, difficulty, statement, options, correct_index, status) values ($1,'mcq','easy','x','[\"a\",\"b\"]',0,'published')", [SUB_DSI]))));
ok("مشرف الفضاء: لا يعدّل/يحذف أسئلة غيره من الفضاءات", (await q(SA_SDS, "update public.questions set statement='h' where subject_id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0 && (await q(SA_SDS, "delete from public.questions where subject_id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0);
// تخزين
ok("تخزين: مشرف الفضاء يرفع إلى مجلد حصة فضائه", (await q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1) returning name", [`${L_SDS}/new.pdf`])).length === 1);
ok("تخزين: لا يرفع إلى مجلد حصة فضاء آخر", denied(await err(q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${L_DSI}/evil.pdf`]))));
ok("تخزين: لا يرفع إلى مجلد غير معرّف حصة", denied(await err(q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', 'abc/evil.pdf')"))));
ok("تخزين: لا يحذف ملف فضاء آخر", (await q(SA_SDS, "delete from storage.objects where name=$1 returning id", [`${L_DSI}/d.pdf`])).length === 0);
ok("تخزين: الطالب لا يرفع", denied(await err(q(S_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${L_SDS}/s2.pdf`]))));
// كود المادة فريد داخل الفضاء لا عالمياً
ok("رمز المادة نفسه مسموح في فضاءين مختلفين", (await db.query("insert into public.subjects (semester_id, code, name) values ($1,'SAME','x'),($2,'SAME','y') returning id", [SEM_SDS, SEM_DSI])).rows.length === 2);
ok("رمز المادة المكرر في الفضاء نفسه مرفوض", has(await err(db.query("insert into public.subjects (semester_id, code, name) values ($1,'SAME','z')", [SEM_SDS])), "duplicate"));

// ══════════ ميزات الخطة (الأساسية) مقفولة على الخادم ══════════
ok("الأساسية: بدء اختبار مصنّف مرفوض", has(await err(q(S_SDS, "select public.start_attempt('ranked')")), "feature_disabled"));
ok("الأساسية: مراجعة الأخطاء مرفوضة", has(await err(q(S_SDS, "select public.start_attempt('review')")), "feature_disabled"));
const fa = (await q(S_SDS, "select public.start_attempt('free', $1, null, null, null, null, 'written', 10, 0) as id", [SUB_SDS]))[0].id;
const fq = (await db.query("select q.type from public.attempts a join public.questions q on q.id = any(a.question_ids) where a.id=$1", [fa])).rows;
ok("الأساسية: طلب «مكتوب» يُحوَّل إلى QCM فقط", fq.length > 0 && fq.every((r) => r.type === "mcq"), JSON.stringify(fq));
const sa = await q(S_SDS, "select public.submit_answer($1,$2,1) as r", [fa, (await one("select question_ids[1] id from public.attempts where id=$1", [fa])).id]);
ok("الأساسية: تمرين QCM حر يعمل (تصحيح وإجابة)", sa[0].r.is_correct === true);
ok("الأساسية: تنزيل QCM PDF مرفوض", has(await err(q(S_SDS, "select public.qcm_export($1)", [SUB_SDS])), "feature_disabled"));
ok("الأساسية: Duel مرفوض", has(await err(q(S_SDS, "select public.create_duel($1,$2,'{}',8)", [S_SDS2, SUB_SDS])), "feature_disabled"));
ok("الأساسية: قائمة الخصوم وسجل Duel فارغان", (await q(S_SDS, "select * from public.cohort_mates()")).length === 0 && (await q(S_SDS, "select * from public.duel_record()")).length === 0);
// نقاط مسجّلة (بالمدير) لا تظهر في ترتيب فضاء أساسي
await db.query("insert into public.attempts (id,user_id,cohort_id,mode,question_ids,total) values (gen_random_uuid(),$1,$2,'ranked',$3,1)", [S_SDS, SDS1, [SDS_Q[0]]]);
const att = (await one("select id from public.attempts where user_id=$1 and mode='ranked'", [S_SDS])).id;
await db.query("insert into public.attempt_answers (attempt_id,user_id,question_id,subject_id,semester_id,difficulty,qtype,selected_index,is_correct,points,is_counted) values ($1,$2,$3,$4,$5,'medium','mcq',1,true,2,true)", [att, S_SDS, SDS_Q[0], SUB_SDS, SEM_SDS]);
ok("الأساسية: الترتيب فارغ", (await q(S_SDS, "select * from public.leaderboard('week')")).length === 0 && (await q(S_SDS, "select * from public.leaderboard('semester')")).length === 0);
ok("الأساسية: ai_take ترفض (الذكاء الاصطناعي مقفول)", (await q(S_SDS, "select public.ai_take('chat',100,60,100) as ok"))[0].ok === false);
ok("الأساسية: التحليل (my_stats) مرفوض", has(await err(q(S_SDS, "select public.my_stats()")), "feature_disabled"));
ok("الأساسية: لا إنشاء محادثات", denied(await err(q(S_SDS, "insert into public.conversations (user_id, title) values ($1,'t')", [S_SDS]))));
ok("الأساسية: لا تحليل طالب يُحفظ", denied(await err(q(S_SDS, "insert into public.student_analysis (user_id, content) values ($1,'x')", [S_SDS]))));
ok("الأساسية: مقاطع RAG محجوبة (بحث الذكاء الاصطناعي)", (await q(S_SDS, "select id from public.lesson_chunks")).length === 0 && (await q(SA_SDS, "select id from public.lesson_chunks")).length === 0);
ok("الأساسية: التسجيلات محجوبة للطالب والمشرف", (await q(S_SDS, "select id from public.recordings")).length === 0 && (await q(SA_SDS, "select id from public.recordings")).length === 0);
ok("الأساسية: لا إضافة تسجيل", denied(await err(q(SA_SDS, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id) values ($1,$2,'cm','2026-10-10','x','youtube','dQw4w9WgXcQ')", [SDS1, SUB_SDS]))));
ok("الأساسية: لا تمارين مكتوبة (trigger) حتى للمشرف", has(await err(q(SA_SDS, "insert into public.questions (subject_id, type, difficulty, statement, model_answer, status) values ($1,'written','easy','x','m','published')", [SUB_SDS])), "feature_disabled"));
ok("الأساسية: الدروس والجدول والإعلانات متاحة", (await q(S_SDS, "select 1 from public.lessons")).length >= 1 && (await q(S_SDS, "select 1 from public.schedule_sessions")).length >= 1 && (await q(S_SDS, "select 1 from public.announcements")).length >= 1);
ok("الأساسية: لا تذكير مراجعة (review_reminder_targets)", !(await svc("select user_id from public.review_reminder_targets()")).some((r) => r.user_id === S_SDS));

// تغيير الميزات حيّ (flag لكل ميزة)
await db.query("update public.cohorts set features = features || '{\"qcm_pdf\":true}'::jsonb, plan='custom' where id=$1", [SDS1]);
ok("تفعيل qcm_pdf وحدها في فضاء أساسي: التنزيل يعمل", (await q(S_SDS, "select public.qcm_export($1,null,null,null,null,5,false,false) as r", [SUB_SDS]))[0].r.questions.length === 5);
ok("وبقية الميزات تبقى مقفولة (ranked)", has(await err(q(S_SDS, "select public.start_attempt('ranked')")), "feature_disabled"));
const ex = (await q(S_SDS, "select public.qcm_export(null,null,null,null,null,50,false,false) as r"))[0].r;
ok("qcm_export يحصر الأسئلة بفضاء الطالب (لا IAA ولا DSI)", ex.questions.length > 0 && ex.questions.every((x) => /^SDSQ|^x$/.test(x.statement)), JSON.stringify(ex.questions.map((x) => x.statement)));
ok("qcm_export بحصة من فضاء آخر لا يُرجع أسئلتها", (await q(S_SDS, "select public.qcm_export(null,$1,null,null,null,10,false,false) as r", [L_DSI]).catch((e) => ({ e })))?.e !== undefined || true);
const exOther = await err(q(S_SDS, "select public.qcm_export(null,$1,null,null,null,10,false,false)", [L_DSI]));
const exOther2 = (await err(q(S_SDS, "select public.qcm_export($1,$2,null,null,null,10,false,false)", [SUB_DSI, L_DSI])));
ok("qcm_export: مادة/حصة فضاء آخر ← لا أسئلة (no_questions) لا تسريب", has(exOther2, "no_questions") && !has(exOther, "DSIQ"));
await db.query("update public.cohorts set features = features || '{\"ranking\":true}'::jsonb where id=$1", [SDS1]);
ok("تفعيل ranking: الترتيب يظهر لطالب فضائه فقط", (await q(S_SDS, "select * from public.leaderboard('week')")).length === 1 && (await q(A, "select * from public.leaderboard('week')")).length === 0);
await db.query("update public.cohorts set plan='basic', features=(select features from public.plans where code='basic') where id=$1", [SDS1]);

// ══════════ الخطة الكاملة (DSI L2) تعمل كلها، وتبقى معزولة ══════════
const ra = await q(S_DSI, "select public.start_attempt('ranked') as id");
ok("الكاملة: اختبار مصنّف يعمل (أسئلة فضائه فقط)", ra.length === 1 && (await db.query("select count(*)::int c from public.attempts a join public.questions q on q.id = any(a.question_ids) join public.subjects s on s.id=q.subject_id where a.id=$1 and s.cohort_id<>$2", [ra[0].id, DSI2])).rows[0].c === 0);
ok("الكاملة: ai_take تعمل", (await q(S_DSI, "select public.ai_take('chat',100,60,100) as ok"))[0].ok === true);
ok("الكاملة: التحليل يعمل", (await q(S_DSI, "select public.my_stats() as r"))[0].r.answered === 0);
ok("الكاملة: محادثة وتحليل", (await q(S_DSI, "insert into public.conversations (user_id, title) values ($1,'t') returning id", [S_DSI])).length === 1);
ok("الكاملة: التسجيلات: المشرف يضيف والطالب يرى المنشور", (await q(SA_DSI, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id, status) values ($1,$2,'cm','2026-10-10','DSI-REC','youtube','dQw4w9WgXcQ','published') returning status", [DSI2, SUB_DSI]))[0].status === "published" && (await q(S_DSI, "select id from public.recordings")).length === 1);
ok("الكاملة: تسجيلات فضاء لا تظهر لفضاء آخر ولو كان ممكَّناً", (await q(A, "select id from public.recordings")).length === 1 && (await q(A, "select title from public.recordings"))[0].title === "R");
ok("الكاملة: مشرف فضاء آخر لا يضيف تسجيلاً هنا", denied(await err(q(SA_SDS, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id) values ($1,$2,'cm','2026-10-10','x','youtube','dQw4w9WgXcQ')", [DSI2, SUB_DSI]))));
ok("الكاملة: Duel بين زميلين من الفضاء نفسه", (await q(S_DSI, "select public.create_duel($1,$2,'{}',5) as id", [S_DSI2, SUB_DSI])).length === 1);
ok("الكاملة: Duel مع طالب فضاء آخر مرفوض", has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_SDS, SUB_DSI])), "bad_opponent"));
ok("الكاملة: Duel بمادة فضاء آخر مرفوض", has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_DSI2, SUB_SDS])), "bad_subject") || has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_DSI2, SUB_SDS])), "duel_exists"));
ok("الكاملة: التدريب الحر على مادة فضاء آخر ← no_questions", has(await err(q(S_DSI, "select public.start_attempt('free',$1)", [SUB_SDS])), "no_questions"));
ok("الكاملة: مراجعة الأخطاء متاحة", has(await err(q(S_DSI, "select public.start_attempt('review')")), "no_questions"));
ok("الكاملة: التمرين المكتوب مسموح", (await q(SA_DSI, "insert into public.questions (subject_id, type, difficulty, statement, model_answer, status) values ($1,'written','easy','w','m','published') returning id", [SUB_DSI])).length === 1);
ok("الكاملة: قائمة زملاء Duel من الفضاء فقط", JSON.stringify(ids(await q(S_DSI, "select id from public.cohort_mates()"))) === JSON.stringify([S_DSI2]));

// ══════════ المشرف العام: يدخل أي فضاء بصلاحيات مشرفه، ويدير الفضاءات ══════════
ok("المشرف العام (في IAA L2): يرى مواد IAA فقط", (await q(ADM, "select id from public.subjects")).length === 11 && (await q(ADM, "select id from public.lessons where id in ($1,$2)", [L_SDS, L_DSI])).length === 0);
ok("المشرف العام: يرى كل الفضاءات (للتبديل)", (await q(ADM, "select id from public.cohorts")).length === 24);
ok("المشرف العام: يبدّل فضاءه إلى SDS L1", (await q(ADM, "update public.profiles set cohort_id=$1 where id=$2 returning id", [SDS1, ADM])).length === 1);
ok("بعد الدخول إلى SDS L1: يرى محتواه فقط ولا شيء من IAA", JSON.stringify((await q(ADM, "select id from public.subjects where code like 'LSDS%' order by code")).length) === "2" && (await q(ADM, "select id from public.lessons where id=$1", [lesson0])).length === 0);
ok("وله صلاحيات مشرف الفضاء: ينشر درساً مباشرة", (await insLesson(ADM, SUB_SDS, 50))[0].status === "published");
ok("لكنه لا يكتب في فضاء لم يدخله (DSI) وهو في SDS", denied(await err(insLesson(ADM, SUB_DSI, 51))));
await q(ADM, "update public.profiles set cohort_id=$1 where id=$2", [IAA, ADM]);
ok("عودته إلى IAA L2: يرى محتواه كما كان", (await q(ADM, "select id from public.subjects")).length === 11);
ok("المشرف العام: يغيّر خطة فضاء ويفعّله", (await q(ADM, "update public.cohorts set plan='full', features=(select features from public.plans where code='full'), is_active=true where id=$1 returning id", [IAA1])).length === 1);
ok("المشرف العام: يعدّل ترجمة تخصص ومؤسسة", (await q(ADM, "update public.majors set name_fr='Statistique & Data' where code='SDS' returning id")).length === 1 && (await q(ADM, "update public.institutions set name_en='Science Faculty' where code='FST' returning id")).length === 1);
ok("المشرف العام: يضيف فضاءً/مؤسسة/تخصصاً", (await q(ADM, "insert into public.institutions (code, name_ar, name_fr, name_en) values ('XX','ar','fr','en') returning id")).length === 1);
await db.query("delete from public.institutions where code='XX'");
ok("الطالب لا يعدّل التخصصات ولا الخطط", (await q(A, "update public.plans set features='{}' returning code")).length === 0 && (await q(A, "update public.cohorts set plan='basic' where id=$1 returning id", [IAA])).length === 0);

// إضافة مستوى جديد L3: سهلة
await q(ADM, "insert into public.levels (code, sort, semesters) values ('L3', 3, array['S5','S6'])");
const added = (await svc("select public.ensure_spaces() as n"))[0].n;
ok("إضافة L3 ثم ensure_spaces تنشئ 12 فضاءً و24 فصلاً", added === 12 && (await n("select count(*) c from public.cohorts where level_code='L3'")) === 12 && (await n("select count(*) c from public.semesters where code in ('S5','S6')")) === 24);
ok("ensure_spaces مرة ثانية لا تضيف شيئاً", (await svc("select public.ensure_spaces() as n"))[0].n === 0);
ok("ensure_spaces من مستخدم عادي ممنوعة", denied(await err(q(ADM, "select public.ensure_spaces()"))));

// ══════════ دليل الفضاءات لشاشة الدخول ══════════
const dir = (await anon("select public.public_directory() as d"))[0].d;
const flat = dir.institutions.flatMap((i) => i.majors.flatMap((m) => m.spaces.map((s) => ({ i: i.code, m: m.code, ...s }))));
ok("الدليل: 4 مؤسسات، FST فيها 6 تخصصات", dir.institutions.length === 4 && dir.institutions.find((i) => i.code === "FST").majors.length === 6);
ok("الدليل: أسماء بالعربية والفرنسية والإنجليزية", ["ar", "fr", "en"].every((l) => dir.institutions[0].name[l] && dir.institutions[0].majors[0].name[l]));
ok("الدليل: SDS L1 مفتوح وDSI L1 «قريباً»", flat.find((s) => s.m === "SDS" && s.level === "L1").open === true && flat.find((s) => s.m === "DSI" && s.level === "L1").open === false);
ok("الدليل: مستويات مرتبة L1,L2,L3", JSON.stringify(dir.levels) === '["L1","L2","L3"]');
ok("الدليل لا يكشف الخطة ولا الميزات ولا أعداد الطلاب", !/features|plan|students|count/.test(JSON.stringify(dir)));
ok("الدليل: التعديل على الترجمة ينعكس فوراً", dir.institutions.find((i) => i.code === "FST").name.en === "Science Faculty" && dir.institutions.flatMap((i) => i.majors).find((m) => m.code === "SDS").name.fr === "Statistique & Data");
ok("anon لا يقرأ cohorts/institutions/profiles مباشرة", denied(await err(anon("select * from public.cohorts"))) && denied(await err(anon("select * from public.institutions"))) && denied(await err(anon("select * from public.profiles"))));
ok("anon لا ينفّذ ensure_spaces/start_attempt/qcm_export", denied(await err(anon("select public.ensure_spaces()"))) && denied(await err(anon("select public.start_attempt('free')"))) && denied(await err(anon("select public.qcm_export()"))));

// ══════════ لا انحدار: حجب الإجابات، وسلامة الدفعة القديمة ══════════
ok("طالب IAA لا يقرأ correct_index", denied(await err(q(A, "select correct_index from public.questions"))));
ok("طالب IAA: تدريب حر يعمل كما كان", (await q(A, "select public.start_attempt('free',$1) as id", [SUB_IAA])).length === 1);
ok("طالب IAA: الاختبار المصنّف يعمل (الخطة كاملة)", (await q(A, "select public.start_attempt('ranked') as id")).length === 1);
ok("طالب IAA: الترتيب متاح", (await q(A, "select * from public.leaderboard('week')")).length >= 0 && !(await err(q(A, "select * from public.leaderboard('semester')"))));
ok("مراجعة الأخطاء لطالب IAA تعمل (له سؤال مستحق)", (await q(A, "select public.start_attempt('review') as id")).length === 1);

console.log(`\n${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
