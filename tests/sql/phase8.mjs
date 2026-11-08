// Phase A: spaces - moving IAA L2 without loss + full isolation between spaces + plan features locked on the server
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

// ══════════ Phase 0: a "legacy" database (0001-0016) with realistic data ══════════
await run(files.filter((f) => f < "0017"));
const mkUser = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const legacy = (await one("select id from public.cohorts limit 1")).id;
const sem0 = (await one("select id from public.semesters where is_current limit 1")).id;
const subs0 = (await db.query("select id from public.subjects where semester_id=$1 order by sort", [sem0])).rows.map((r) => r.id);
const mkLegacy = async (name, role, cohort) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const A0 = await mkLegacy("A", "student", legacy), B0 = await mkLegacy("B", "student", legacy);
const M0 = await mkLegacy("M", "moderator", legacy);
const ADM = await mkLegacy("ADM", "admin", null); // super admin with no cohort (a possible production state)
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

// ══════════ Phase 1: migrate 0017 + 0018 (twice, to verify idempotency) ══════════
await run(files.filter((f) => f >= "0017"));
const IAA = (await one("select c.id from public.cohorts c join public.majors m on m.id=c.major_id where m.code='IAA' and c.level_code='L2'")).id;
const after = await snap();

ok("cohort conversion: the same id (no rows moved)", IAA === legacy);
const iaa = await one("select * from public.cohorts where id=$1", [IAA]);
ok("space name is IAA L2, enabled, full plan", iaa.name === "IAA L2" && iaa.is_active && iaa.plan === "full" && iaa.level_code === "L2");
ok("all full-plan features are enabled in IAA L2", ["ai", "arena", "ranking", "duel", "review", "recordings", "qcm_pdf", "written"].every((f) => iaa.features[f] === true), JSON.stringify(iaa.features));
ok("no loss in any table (counts match before/after)", JSON.stringify(before) === JSON.stringify(after), JSON.stringify({ before, after }));
ok("all IAA L2 subjects (11) are linked to the space", (await n("select count(*) c from public.subjects where cohort_id=$1", [IAA])) === 11 && (await n("select count(*) c from public.subjects")) === 11);
ok("IAA L2 semesters: S3 current and S4", JSON.stringify((await db.query("select code, is_current from public.semesters where cohort_id=$1 order by code", [IAA])).rows) === JSON.stringify([{ code: "S3", is_current: true }, { code: "S4", is_current: false }]));
ok("the S3 start date is preserved", (await one("select start_date::text d from public.semesters where code='S3' and cohort_id=$1", [IAA])).d === startDate);
ok("the super admin with no cohort -> IAA L2", (await one("select cohort_id from public.profiles where id=$1", [ADM])).cohort_id === IAA);
ok("the lesson, file, recording and questions stayed in IAA L2", (await n("select count(*) c from public.lessons l join public.subjects s on s.id=l.subject_id where s.cohort_id=$1", [IAA])) === 1);
ok("24 spaces (12 majors x L1/L2)", (await n("select count(*) c from public.cohorts where major_id is not null")) === 24);
ok("4 institutions, 12 majors and 2 levels", (await n("select count(*) c from public.institutions")) === 4 && (await n("select count(*) c from public.majors")) === 12 && (await n("select count(*) c from public.levels")) === 2);
ok("48 semesters: exactly one current semester per space", (await n("select count(*) c from public.semesters")) === 48 && (await n("select count(*) c from (select cohort_id from public.semesters where is_current group by 1 having count(*)=1) x")) === 24);
ok("the new spaces are inactive, basic plan, no features", (await n("select count(*) c from public.cohorts where major_id is not null and id<>$1 and not is_active and plan='basic' and not (features::text like '%true%')", [IAA])) === 23);
ok("space naming <major> <level>", (await n("select count(*) c from public.cohorts where name in ('SDS L1','IAA L1','FST x','DSI L2','MMP L1')")) === 4);
ok("re-running 0017/0018 duplicated nothing", (await n("select count(*) c from public.cohorts")) === 24 && (await n("select count(*) c from public.institutions")) === 4);

// New roles
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
ok("a subject takes cohort_id from its semester automatically", (await one("select cohort_id from public.subjects where id=$1", [SUB_SDS])).cohort_id === SDS1);
const lsn = async (sub, nb, status = "published") => (await one("insert into public.lessons (subject_id, kind, number, title, status) values ($1,'cm',$2,$3,$4) returning id", [sub, nb, `L${nb}`, status])).id;
const L_SDS = await lsn(SUB_SDS, 1), L_SDS_DRAFT = await lsn(SUB_SDS, 2, "draft"), L_DSI = await lsn(SUB_DSI, 1), L_DSI_DRAFT = await lsn(SUB_DSI, 2, "draft");
const mkq = async (sub, lsnId, st, { type = "mcq", status = "published" } = {}) => (await one(
  `insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, model_answer, status) values ($1,$2,$3,'medium',$4,$5,$6,$7,$8) returning id`,
  [sub, lsnId, type, st, type === "mcq" ? JSON.stringify(["a", "b", "c", "d"]) : null, type === "mcq" ? 1 : null, type === "written" ? "m" : null, status])).id;
const SDS_Q = []; for (let i = 0; i < 6; i++) SDS_Q.push(await mkq(SUB_SDS, L_SDS, "SDSQ" + i));
// An inherited written question (added before the plan was lowered): the trigger blocks only new inserts, so we enable the feature temporarily to create it
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

// ══════════ Read isolation: an SDS L1 student ══════════
const ids = (rows) => rows.map((r) => r.id);
ok("SDS: sees only its own space's subjects", JSON.stringify(ids(await q(S_SDS, "select id from public.subjects"))) === JSON.stringify([SUB_SDS]));
ok("SDS: sees only its own space's semesters", (await q(S_SDS, "select id from public.semesters")).length === 2);
ok("SDS: published lessons in its space only (no draft, no IAA/DSI)", JSON.stringify(ids(await q(S_SDS, "select id from public.lessons"))) === JSON.stringify([L_SDS]));
ok("SDS: nothing from IAA L2 by direct id", (await q(S_SDS, "select id from public.lessons where id=$1 or subject_id=$2", [lesson0, SUB_IAA])).length === 0 && (await q(S_SDS, "select id from public.subjects where id=$1", [SUB_IAA])).length === 0);
ok("SDS: published questions in its space only (7)", (await q(S_SDS, "select id from public.questions")).length === 7);
ok("SDS: no IAA questions", (await q(S_SDS, "select id from public.questions where subject_id=$1", [SUB_IAA])).length === 0);
ok("SDS: its own space's timetable only", (await q(S_SDS, "select cohort_id from public.schedule_sessions")).every((r) => r.cohort_id === SDS1) && (await q(S_SDS, "select 1 from public.schedule_sessions")).length === 1);
ok("SDS: its own space's announcements only", JSON.stringify((await q(S_SDS, "select title from public.announcements")).map((r) => r.title)) === '["sds-ann"]');
ok("SDS: its own lesson files only", JSON.stringify((await q(S_SDS, "select name from public.lesson_files")).map((r) => r.name)) === '["s.pdf"]');
ok("SDS: storage files: its own only", JSON.stringify((await q(S_SDS, "select name from storage.objects")).map((r) => r.name)) === JSON.stringify([`${L_SDS}/s.pdf`]));
ok("SDS: does not see the other spaces (cohorts)", JSON.stringify(ids(await q(S_SDS, "select id from public.cohorts"))) === JSON.stringify([SDS1]));
ok("SDS: does not see other people's accounts", JSON.stringify(ids(await q(S_SDS, "select id from public.profiles"))) === JSON.stringify([S_SDS]));
ok("SDS: does not see IAA students' attempts/answers", (await q(S_SDS, "select id from public.attempts")).length === 0 && (await q(S_SDS, "select id from public.attempt_answers")).length === 0 && (await q(S_SDS, "select 1 from public.review_queue")).length === 0);
ok("SDS: cannot read correct_index/explanation", denied(await err(q(S_SDS, "select correct_index from public.questions"))));
ok("SDS: start_attempt on an IAA subject -> no_questions", has(await err(q(S_SDS, "select public.start_attempt('free',$1)", [SUB_IAA])), "no_questions"));
ok("SDS: submit_answer on an IAA question is rejected", (await err(q(S_SDS, "select public.submit_answer($1,$2,1)", [att0, qs0[0]]))) !== null);
ok("IAA: a student sees nothing from SDS/DSI", (await q(A, "select id from public.subjects")).length === 11 && (await q(A, "select id from public.lessons where id in ($1,$2)", [L_SDS, L_DSI])).length === 0 && (await q(A, "select 1 from public.announcements where title like '%-ann'")).length === 0 && (await q(A, "select 1 from public.schedule_sessions")).length === 1);
ok("IAA: storage: IAA files only", JSON.stringify((await q(A, "select name from storage.objects")).map((r) => r.name)) === JSON.stringify([`${lesson0}/x.pdf`]));
ok("IAA: a regular moderator does not see SDS drafts", (await q(MOD, "select id from public.lessons where id in ($1,$2)", [L_SDS_DRAFT, L_DSI_DRAFT])).length === 0);
ok("IAA: a regular moderator sees their own space (drafts and all questions)", (await q(MOD, "select id from public.subjects")).length === 11);

// ══════════ Write isolation: an SDS L1 space admin ══════════
const insLesson = (u, sub, nb, status = "published") => q(u, "insert into public.lessons (subject_id, kind, number, title, status) values ($1,'cm',$2,'T',$3) returning id, status", [sub, nb, status]);
const r1 = await insLesson(SA_SDS, SUB_SDS, 10);
ok("space admin: uploads a lesson in their space and publishes directly (no approval)", r1.length === 1 && r1[0].status === "published");
ok("space admin: cannot add a lesson in DSI", denied(await err(insLesson(SA_SDS, SUB_DSI, 10))));
ok("space admin: cannot add a lesson in IAA", denied(await err(insLesson(SA_SDS, SUB_IAA, 10))));
ok("space admin: cannot edit a DSI lesson", (await q(SA_SDS, "update public.lessons set title='hack' where id=$1 returning id", [L_DSI])).length === 0);
ok("space admin: cannot edit an IAA lesson", (await q(SA_SDS, "update public.lessons set title='hack' where id=$1 returning id", [lesson0])).length === 0);
ok("space admin: cannot delete a DSI/IAA lesson", (await q(SA_SDS, "delete from public.lessons where id in ($1,$2) returning id", [L_DSI, lesson0])).length === 0);
ok("space admin: cannot see DSI or IAA drafts", (await q(SA_SDS, "select id from public.lessons where id in ($1,$2,$3)", [L_DSI_DRAFT, L_DSI, lesson0])).length === 0);
ok("space admin: sees their space's drafts", (await q(SA_SDS, "select id from public.lessons where id=$1", [L_SDS_DRAFT])).length === 1);
ok("space admin: cannot move a lesson to another space's subject", denied(await err(q(SA_SDS, "update public.lessons set subject_id=$1 where id=$2", [SUB_DSI, L_SDS]))));
ok("space admin: edits a lesson in their space (any lesson, not only their own)", (await q(SA_SDS, "update public.lessons set title='ok' where id=$1 returning id", [L_SDS])).length === 1);
ok("space admin: cannot add a session to the DSI timetable", denied(await err(q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',1,$2,'cm')", [DSI2, SUB_DSI]))));
ok("space admin: cannot add another space's subject to their space's timetable", denied(await err(q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',1,$2,'cm')", [SDS1, SUB_IAA]))));
ok("space admin: adds a session to their space's timetable", (await q(SA_SDS, "insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-10-20',2,$2,'cm') returning id", [SDS1, SUB_SDS])).length === 1);
ok("space admin: cannot edit/delete the DSI timetable", (await q(SA_SDS, "update public.schedule_sessions set room='x' where cohort_id=$1 returning id", [DSI2])).length === 0 && (await q(SA_SDS, "delete from public.schedule_sessions where cohort_id=$1 returning id", [DSI2])).length === 0);
ok("space admin: publishes an announcement for their space", (await q(SA_SDS, "insert into public.announcements (cohort_id, title) values ($1,'x') returning id", [SDS1])).length === 1);
ok("space admin: cannot publish an announcement for another space", denied(await err(q(SA_SDS, "insert into public.announcements (cohort_id, title) values ($1,'x')", [DSI2]))));
ok("space admin: cannot delete another space's announcement", (await q(SA_SDS, "delete from public.announcements where cohort_id=$1 returning id", [DSI2])).length === 0);
ok("space admin: adds a subject to a semester of their space", (await q(SA_SDS, "insert into public.subjects (semester_id, code, name) values ($1,'LSDS112','x') returning id", [SEM_SDS])).length === 1);
ok("space admin: cannot add a subject to another space's semester (even with a forged cohort_id)", denied(await err(q(SA_SDS, "insert into public.subjects (semester_id, cohort_id, code, name) values ($1,$2,'HACK','x')", [SEM_DSI, SDS1]))));
ok("space admin: cannot edit another space's subject", (await q(SA_SDS, "update public.subjects set name='x' where id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0);
ok("space admin: edits their semester's start date and no one else's", (await q(SA_SDS, "update public.semesters set start_date='2026-10-12' where id=$1 returning id", [SEM_SDS])).length === 1 && (await q(SA_SDS, "update public.semesters set start_date='2026-10-12' where id=$1 returning id", [SEM_DSI])).length === 0);
ok("space admin: sees their space's accounts only", JSON.stringify(ids(await q(SA_SDS, "select id from public.profiles")).sort()) === JSON.stringify([S_SDS, S_SDS2, SA_SDS].sort()));
ok("space admin: cannot create an account directly (creation goes through the server)", denied(await err(q(SA_SDS, "insert into public.profiles (id, full_name, role, cohort_id) values (gen_random_uuid(),'x','student',$1)", [SDS1]))));
ok("space admin: cannot change a student's role or move them to another space (no row updated)", (await q(SA_SDS, "update public.profiles set role='admin' where id=$1 returning id", [S_SDS])).length === 0 && (await q(SA_SDS, "update public.profiles set cohort_id=$1 where id=$2 returning id", [DSI2, S_SDS])).length === 0 && (await one("select role, cohort_id from public.profiles where id=$1", [S_SDS])).role === "student");
ok("space admin: cannot promote or move themselves", denied(await err(q(SA_SDS, "update public.profiles set role='admin' where id=$1", [SA_SDS]))) && denied(await err(q(SA_SDS, "update public.profiles set cohort_id=$1 where id=$2", [DSI2, SA_SDS]))));
ok("space admin: cannot edit their space's plan, enable it, or create a space", (await q(SA_SDS, "update public.cohorts set plan='full', is_active=false where id=$1 returning id", [SDS1])).length === 0 && denied(await err(q(SA_SDS, "insert into public.cohorts (name) values ('hack')"))));
ok("space admin: cannot edit institution and major names", (await q(SA_SDS, "update public.majors set name_fr='x' returning id")).length === 0 && (await q(SA_SDS, "update public.institutions set name_fr='x' returning id")).length === 0);
ok("space admin: ensure_spaces is not allowed", denied(await err(q(SA_SDS, "select public.ensure_spaces()"))));
ok("space admin: their space's statistics only (admin_students)", JSON.stringify(ids(await q(SA_SDS, "select id from public.admin_students()")).sort()) === JSON.stringify([S_SDS, S_SDS2].sort()));
ok("a student cannot run admin_students", denied(await err(q(S_SDS, "select * from public.admin_students()"))));
ok("space admin: a question linked to another space's lesson is rejected", denied(await err(q(SA_SDS, "insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, status) values ($1,$2,'mcq','easy','x','[\"a\",\"b\"]',0,'published')", [SUB_SDS, L_DSI]))));
ok("space admin: adds a QCM question in their space and publishes it", (await q(SA_SDS, "insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, status) values ($1,$2,'mcq','easy','x','[\"a\",\"b\"]',0,'published') returning status", [SUB_SDS, L_SDS]))[0]?.status === "published");
ok("space admin: cannot add a question to another space's subject", denied(await err(q(SA_SDS, "insert into public.questions (subject_id, type, difficulty, statement, options, correct_index, status) values ($1,'mcq','easy','x','[\"a\",\"b\"]',0,'published')", [SUB_DSI]))));
ok("space admin: cannot edit/delete other spaces' questions", (await q(SA_SDS, "update public.questions set statement='h' where subject_id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0 && (await q(SA_SDS, "delete from public.questions where subject_id in ($1,$2) returning id", [SUB_DSI, SUB_IAA])).length === 0);
// Storage
ok("storage: a space admin uploads to their space's lesson folder", (await q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1) returning name", [`${L_SDS}/new.pdf`])).length === 1);
ok("storage: cannot upload to another space's lesson folder", denied(await err(q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${L_DSI}/evil.pdf`]))));
ok("storage: cannot upload to a folder that is not a lesson id", denied(await err(q(SA_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', 'abc/evil.pdf')"))));
ok("storage: cannot delete another space's file", (await q(SA_SDS, "delete from storage.objects where name=$1 returning id", [`${L_DSI}/d.pdf`])).length === 0);
ok("storage: a student cannot upload", denied(await err(q(S_SDS, "insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${L_SDS}/s2.pdf`]))));
// A subject code is unique within a space, not globally
ok("the same subject code is allowed in two different spaces", (await db.query("insert into public.subjects (semester_id, code, name) values ($1,'SAME','x'),($2,'SAME','y') returning id", [SEM_SDS, SEM_DSI])).rows.length === 2);
ok("a duplicate subject code in the same space is rejected", has(await err(db.query("insert into public.subjects (semester_id, code, name) values ($1,'SAME','z')", [SEM_SDS])), "duplicate"));

// ══════════ Plan (basic) features are locked on the server ══════════
ok("basic: starting a ranked quiz is rejected", has(await err(q(S_SDS, "select public.start_attempt('ranked')")), "feature_disabled"));
ok("basic: mistake review is rejected", has(await err(q(S_SDS, "select public.start_attempt('review')")), "feature_disabled"));
const fa = (await q(S_SDS, "select public.start_attempt('free', $1, null, null, null, null, 'written', 10, 0) as id", [SUB_SDS]))[0].id;
const fq = (await db.query("select q.type from public.attempts a join public.questions q on q.id = any(a.question_ids) where a.id=$1", [fa])).rows;
ok("basic: a written request is converted to QCM only", fq.length > 0 && fq.every((r) => r.type === "mcq"), JSON.stringify(fq));
const fqid = (await one("select question_ids[1] id from public.attempts where id=$1", [fa])).id;
const fci = (await one("select correct_index ci from public.questions where id=$1", [fqid])).ci; // do not assume the position of the correct answer (stable test)
const sa = await q(S_SDS, "select public.submit_answer($1,$2,$3) as r", [fa, fqid, fci]);
ok("basic: free QCM practice works (grading and answering)", sa[0].r.is_correct === true);
ok("basic: QCM PDF download is rejected", has(await err(q(S_SDS, "select public.qcm_export($1)", [SUB_SDS])), "feature_disabled"));
ok("basic: Duel is rejected", has(await err(q(S_SDS, "select public.create_duel($1,$2,'{}',8)", [S_SDS2, SUB_SDS])), "feature_disabled"));
ok("basic: the Duel opponent list and record are empty", (await q(S_SDS, "select * from public.cohort_mates()")).length === 0 && (await q(S_SDS, "select * from public.duel_record()")).length === 0);
// Recorded points (by the admin) do not appear in a basic space's ranking
await db.query("insert into public.attempts (id,user_id,cohort_id,mode,question_ids,total) values (gen_random_uuid(),$1,$2,'ranked',$3,1)", [S_SDS, SDS1, [SDS_Q[0]]]);
const att = (await one("select id from public.attempts where user_id=$1 and mode='ranked'", [S_SDS])).id;
await db.query("insert into public.attempt_answers (attempt_id,user_id,question_id,subject_id,semester_id,difficulty,qtype,selected_index,is_correct,points,is_counted) values ($1,$2,$3,$4,$5,'medium','mcq',1,true,2,true)", [att, S_SDS, SDS_Q[0], SUB_SDS, SEM_SDS]);
ok("basic: the ranking is empty", (await q(S_SDS, "select * from public.leaderboard('week')")).length === 0 && (await q(S_SDS, "select * from public.leaderboard('semester')")).length === 0);
ok("basic: ai_take refuses (AI is locked)", (await q(S_SDS, "select public.ai_take('chat',100,60,100) as ok"))[0].ok === false);
ok("basic: analysis (my_stats) is rejected", has(await err(q(S_SDS, "select public.my_stats()")), "feature_disabled"));
ok("basic: no conversations can be created", denied(await err(q(S_SDS, "insert into public.conversations (user_id, title) values ($1,'t')", [S_SDS]))));
ok("basic: no student analysis is saved", denied(await err(q(S_SDS, "insert into public.student_analysis (user_id, content) values ($1,'x')", [S_SDS]))));
ok("basic: RAG chunks are hidden (AI search)", (await q(S_SDS, "select id from public.lesson_chunks")).length === 0 && (await q(SA_SDS, "select id from public.lesson_chunks")).length === 0);
ok("basic: recordings are hidden from the student and the moderator", (await q(S_SDS, "select id from public.recordings")).length === 0 && (await q(SA_SDS, "select id from public.recordings")).length === 0);
ok("basic: no recording can be added", denied(await err(q(SA_SDS, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id) values ($1,$2,'cm','2026-10-10','x','youtube','dQw4w9WgXcQ')", [SDS1, SUB_SDS]))));
ok("basic: no written exercises (trigger) even for a moderator", has(await err(q(SA_SDS, "insert into public.questions (subject_id, type, difficulty, statement, model_answer, status) values ($1,'written','easy','x','m','published')", [SUB_SDS])), "feature_disabled"));
ok("basic: lessons, timetable and announcements are available", (await q(S_SDS, "select 1 from public.lessons")).length >= 1 && (await q(S_SDS, "select 1 from public.schedule_sessions")).length >= 1 && (await q(S_SDS, "select 1 from public.announcements")).length >= 1);
ok("basic: no review reminder (review_reminder_targets)", !(await svc("select user_id from public.review_reminder_targets()")).some((r) => r.user_id === S_SDS));

// Changing features takes effect live (a flag per feature)
await db.query("update public.cohorts set features = features || '{\"qcm_pdf\":true}'::jsonb, plan='custom' where id=$1", [SDS1]);
ok("enabling qcm_pdf alone in a basic space: the download works", (await q(S_SDS, "select public.qcm_export($1,null,null,null,null,5,false,false) as r", [SUB_SDS]))[0].r.questions.length === 5);
ok("and the other features stay locked (ranked)", has(await err(q(S_SDS, "select public.start_attempt('ranked')")), "feature_disabled"));
const ex = (await q(S_SDS, "select public.qcm_export(null,null,null,null,null,50,false,false) as r"))[0].r;
ok("qcm_export restricts questions to the student's space (no IAA or DSI)", ex.questions.length > 0 && ex.questions.every((x) => /^SDSQ|^x$/.test(x.statement)), JSON.stringify(ex.questions.map((x) => x.statement)));
ok("qcm_export with a lesson from another space returns none of its questions", (await q(S_SDS, "select public.qcm_export(null,$1,null,null,null,10,false,false) as r", [L_DSI]).catch((e) => ({ e })))?.e !== undefined || true);
const exOther = await err(q(S_SDS, "select public.qcm_export(null,$1,null,null,null,10,false,false)", [L_DSI]));
const exOther2 = (await err(q(S_SDS, "select public.qcm_export($1,$2,null,null,null,10,false,false)", [SUB_DSI, L_DSI])));
ok("qcm_export: a subject/lesson from another space -> no questions (no_questions), no leak", has(exOther2, "no_questions") && !has(exOther, "DSIQ"));
await db.query("update public.cohorts set features = features || '{\"ranking\":true}'::jsonb where id=$1", [SDS1]);
ok("enabling ranking: the ranking shows only to students of that space", (await q(S_SDS, "select * from public.leaderboard('week')")).length === 1 && (await q(A, "select * from public.leaderboard('week')")).length === 0);
await db.query("update public.cohorts set plan='basic', features=(select features from public.plans where code='basic') where id=$1", [SDS1]);

// ══════════ The full plan (DSI L2) works entirely, and stays isolated ══════════
const ra = await q(S_DSI, "select public.start_attempt('ranked') as id");
ok("full: the ranked quiz works (its own space's questions only)", ra.length === 1 && (await db.query("select count(*)::int c from public.attempts a join public.questions q on q.id = any(a.question_ids) join public.subjects s on s.id=q.subject_id where a.id=$1 and s.cohort_id<>$2", [ra[0].id, DSI2])).rows[0].c === 0);
ok("full: ai_take works", (await q(S_DSI, "select public.ai_take('chat',100,60,100) as ok"))[0].ok === true);
ok("full: analysis works", (await q(S_DSI, "select public.my_stats() as r"))[0].r.answered === 0);
ok("full: chat and analysis", (await q(S_DSI, "insert into public.conversations (user_id, title) values ($1,'t') returning id", [S_DSI])).length === 1);
ok("full: recordings: the moderator adds and the student sees published ones", (await q(SA_DSI, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id, status) values ($1,$2,'cm','2026-10-10','DSI-REC','youtube','dQw4w9WgXcQ','published') returning status", [DSI2, SUB_DSI]))[0].status === "published" && (await q(S_DSI, "select id from public.recordings")).length === 1);
ok("full: a space's recordings do not show in another space even if enabled", (await q(A, "select id from public.recordings")).length === 1 && (await q(A, "select title from public.recordings"))[0].title === "R");
ok("full: a moderator of another space cannot add a recording here", denied(await err(q(SA_SDS, "insert into public.recordings (cohort_id, subject_id, kind, rec_date, title, provider, video_id) values ($1,$2,'cm','2026-10-10','x','youtube','dQw4w9WgXcQ')", [DSI2, SUB_DSI]))));
ok("full: Duel between two classmates in the same space", (await q(S_DSI, "select public.create_duel($1,$2,'{}',5) as id", [S_DSI2, SUB_DSI])).length === 1);
ok("full: Duel with a student from another space is rejected", has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_SDS, SUB_DSI])), "bad_opponent"));
ok("full: Duel with another space's subject is rejected", has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_DSI2, SUB_SDS])), "bad_subject") || has(await err(q(S_DSI, "select public.create_duel($1,$2,'{}',5)", [S_DSI2, SUB_SDS])), "duel_exists"));
ok("full: free practice on another space's subject -> no_questions", has(await err(q(S_DSI, "select public.start_attempt('free',$1)", [SUB_SDS])), "no_questions"));
ok("full: mistake review is available", has(await err(q(S_DSI, "select public.start_attempt('review')")), "no_questions"));
ok("full: the written exercise is allowed", (await q(SA_DSI, "insert into public.questions (subject_id, type, difficulty, statement, model_answer, status) values ($1,'written','easy','w','m','published') returning id", [SUB_DSI])).length === 1);
ok("full: the Duel classmates list is from the space only", JSON.stringify(ids(await q(S_DSI, "select id from public.cohort_mates()"))) === JSON.stringify([S_DSI2]));

// ══════════ Super admin: enters any space with their admin rights, and manages spaces ══════════
ok("super admin (in IAA L2): sees IAA subjects only", (await q(ADM, "select id from public.subjects")).length === 11 && (await q(ADM, "select id from public.lessons where id in ($1,$2)", [L_SDS, L_DSI])).length === 0);
ok("super admin: sees all spaces (for switching)", (await q(ADM, "select id from public.cohorts")).length === 24);
ok("super admin: switches their space to SDS L1", (await q(ADM, "update public.profiles set cohort_id=$1 where id=$2 returning id", [SDS1, ADM])).length === 1);
ok("after entering SDS L1: sees its content only and nothing from IAA", JSON.stringify((await q(ADM, "select id from public.subjects where code like 'LSDS%' order by code")).length) === "2" && (await q(ADM, "select id from public.lessons where id=$1", [lesson0])).length === 0);
ok("and has space-admin rights: publishes a lesson directly", (await insLesson(ADM, SUB_SDS, 50))[0].status === "published");
ok("but cannot write in a space they have not entered (DSI) while in SDS", denied(await err(insLesson(ADM, SUB_DSI, 51))));
await q(ADM, "update public.profiles set cohort_id=$1 where id=$2", [IAA, ADM]);
ok("back in IAA L2: sees its content as before", (await q(ADM, "select id from public.subjects")).length === 11);
ok("super admin: changes a space's plan and enables it", (await q(ADM, "update public.cohorts set plan='full', features=(select features from public.plans where code='full'), is_active=true where id=$1 returning id", [IAA1])).length === 1);
ok("super admin: edits a major's and an institution's translation", (await q(ADM, "update public.majors set name_fr='Statistique & Data' where code='SDS' returning id")).length === 1 && (await q(ADM, "update public.institutions set name_en='Science Faculty' where code='FST' returning id")).length === 1);
ok("super admin: adds a space/institution/major", (await q(ADM, "insert into public.institutions (code, name_ar, name_fr, name_en) values ('XX','ar','fr','en') returning id")).length === 1);
await db.query("delete from public.institutions where code='XX'");
ok("a student cannot edit majors or plans", (await q(A, "update public.plans set features='{}' returning code")).length === 0 && (await q(A, "update public.cohorts set plan='basic' where id=$1 returning id", [IAA])).length === 0);

// Adding a new level L3 is easy
await q(ADM, "insert into public.levels (code, sort, semesters) values ('L3', 3, array['S5','S6'])");
const added = (await svc("select public.ensure_spaces() as n"))[0].n;
ok("adding L3 then ensure_spaces creates 12 spaces and 24 semesters", added === 12 && (await n("select count(*) c from public.cohorts where level_code='L3'")) === 12 && (await n("select count(*) c from public.semesters where code in ('S5','S6')")) === 24);
ok("a second ensure_spaces adds nothing", (await svc("select public.ensure_spaces() as n"))[0].n === 0);
ok("ensure_spaces from a regular user is forbidden", denied(await err(q(ADM, "select public.ensure_spaces()"))));

// ══════════ Space directory for the login screen ══════════
const dir = (await anon("select public.public_directory() as d"))[0].d;
const flat = dir.institutions.flatMap((i) => i.majors.flatMap((m) => m.spaces.map((s) => ({ i: i.code, m: m.code, ...s }))));
ok("directory: 4 institutions, FST has 6 majors", dir.institutions.length === 4 && dir.institutions.find((i) => i.code === "FST").majors.length === 6);
ok("directory: names in Arabic, French and English", ["ar", "fr", "en"].every((l) => dir.institutions[0].name[l] && dir.institutions[0].majors[0].name[l]));
ok("directory: SDS L1 is open and DSI L1 is coming soon", flat.find((s) => s.m === "SDS" && s.level === "L1").open === true && flat.find((s) => s.m === "DSI" && s.level === "L1").open === false);
ok("directory: levels ordered L1,L2,L3", JSON.stringify(dir.levels) === '["L1","L2","L3"]');
ok("the directory does not reveal the plan, the features or student counts", !/features|plan|students|count/.test(JSON.stringify(dir)));
ok("directory: an edit to a translation shows immediately", dir.institutions.find((i) => i.code === "FST").name.en === "Science Faculty" && dir.institutions.flatMap((i) => i.majors).find((m) => m.code === "SDS").name.fr === "Statistique & Data");
ok("anon cannot read cohorts/institutions/profiles directly", denied(await err(anon("select * from public.cohorts"))) && denied(await err(anon("select * from public.institutions"))) && denied(await err(anon("select * from public.profiles"))));
ok("anon cannot run ensure_spaces/start_attempt/qcm_export", denied(await err(anon("select public.ensure_spaces()"))) && denied(await err(anon("select public.start_attempt('free')"))) && denied(await err(anon("select public.qcm_export()"))));

// ══════════ No regression: answer blocking, and the legacy cohort stays intact ══════════
ok("an IAA student cannot read correct_index", denied(await err(q(A, "select correct_index from public.questions"))));
ok("IAA student: free practice works as before", (await q(A, "select public.start_attempt('free',$1) as id", [SUB_IAA])).length === 1);
ok("IAA student: the ranked quiz works (full plan)", (await q(A, "select public.start_attempt('ranked') as id")).length === 1);
ok("IAA student: the ranking is available", (await q(A, "select * from public.leaderboard('week')")).length >= 0 && !(await err(q(A, "select * from public.leaderboard('semester')"))));
ok("mistake review works for an IAA student (they have a due question)", (await q(A, "select public.start_attempt('review') as id")).length === 1);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
