// Batch C: remaining L1 subjects (constraints and isolation) + PDF limit and storage usage
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
await db.query(`update public.cohorts set features = features || '{"written":true}' where id=$1`, [SDS1]); // to insert a written question, then lock the feature again
const qWritten = await mkQ(subA, "written"), qB = await mkQ(subB, "mcq");
await db.query(`update public.cohorts set features = features || '{"written":false}' where id=$1`, [SDS1]);
await db.query("insert into public.schedule_sessions (cohort_id, session_date, slot, subject_id, kind) values ($1,'2026-11-02',1,$2,'cm'), ($1,'2026-11-02',2,$3,'cm')", [SDS1, subA, subB]);
await db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','a.pdf',$2,5000000)", [lessonPub, `${lessonPub}/a.pdf`]);
await svc("insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${lessonPub}/a.pdf`]).catch(() => db.query("insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [`${lessonPub}/a.pdf`]));
const add = (u, st, sj) => q(u, "insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [st, sj]);

// ══════════ Constraints ══════════
ok("SDS L2 moderator adds an SDS L1 subject to a student in their space", (await err(add(SA2, S2a, subA))) === null);
ok("rejected: a subject from another major (DSI L1)", has(await err(add(SA2, S2b, subD)), "subject_not_same_major_l1"));
ok("rejected: a subject from the same L2 (not L1)", has(await err(add(SA2, S2b, sub2)), "subject_not_same_major_l1"));
ok("rejected: an L1 student does not follow an L1 subject (L1 to L1)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S1a, subB])), "student_not_l2"));
ok("rejected: the constraint applies even to the service role (L1 student)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S1a, subA])), "student_not_l2"));
ok("rejected: a non-student (moderator) cannot be added", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [MOD, subA])), "not_a_student"));
ok("rejected: an L1 moderator cannot add (outside the student's space)", denied(await err(add(SA1, S2b, subA))));
ok("rejected: a student cannot add for themselves", denied(await err(add(S2b, S2b, subA))));
ok("rejected: a moderator of another major cannot add", denied(await err(add(SAD, S2b, subA))));
ok("rejected: IAA L2 student -> SDS L1 subject (another major)", has(await err(svc("insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [IA, subA])), "subject_not_same_major_l1"));
ok("editing the row is forbidden (no update)", denied(await err(q(SA2, "update public.remaining_subjects set subject_id=$2 where student_id=$1", [S2a, subB]))));

// ══════════ What the student sees ══════════
const subs = (await q(S2a, "select code from public.subjects order by code")).map((r) => r.code);
ok("the student sees only their remaining subject (not STB1 or DSA1)", subs.includes("STA1") && !subs.includes("STB1") && !subs.includes("DSA1") && subs.includes("STA2"), subs.join());
const ls = (await q(S2a, "select id from public.lessons")).map((r) => r.id);
ok("sees the published lesson of the remaining subject, not the draft or other subjects' lessons", ls.includes(lessonPub) && !ls.includes(lessonDraft) && !ls.includes(lessonB));
ok("sees the published lesson file", (await q(S2a, "select id from public.lesson_files where lesson_id=$1", [lessonPub])).length === 1);
ok("a student who does not follow sees nothing from L1", (await q(S2b, "select id from public.lessons where subject_id=$1", [subA])).length === 0 && (await q(S2b, "select id from public.subjects where code='STA1'")).length === 0);
const qs = (await q(S2a, "select id, type from public.questions where subject_id=$1", [subA]));
ok("questions: QCM only (6) and written hidden (basic L1 plan)", qs.length === 6 && qs.every((x) => x.type === "mcq"));
ok("cannot read correct_index", denied(await err(q(S2a, "select correct_index from public.questions"))));
ok("timetable: only the remaining subject's sessions", (await q(S2a, "select subject_id from public.schedule_sessions where cohort_id=$1", [SDS1])).map((r) => r.subject_id).join() === subA);
ok("the Storage file is readable by the follower only", (await q(S2a, "select name from storage.objects where bucket_id='lesson-files'")).length === 1 && (await q(S2b, "select name from storage.objects where bucket_id='lesson-files'")).length === 0);
ok("mark as studied works on a remaining lesson", (await err(q(S2a, "insert into public.lesson_progress (user_id, lesson_id) values ($1,$2)", [S2a, lessonPub]))) === null);

// ══════════ QCM practice ══════════
const att = (await q(S2a, "select public.start_attempt('free',$1) as id", [subA]))[0].id;
const aq = (await db.query("select question_ids from public.attempts where id=$1", [att])).rows[0].question_ids;
ok("free practice on the remaining subject works and includes QCM only", aq.length > 0 && !aq.includes(qWritten));
ok("practice on an L1 subject that is not followed -> no_questions", has(await err(q(S2a, "select public.start_attempt('free',$1)", [subB])), "no_questions"));
ok("the ranked quiz does not include remaining subjects (basic L2 plan -> locked)", has(await err(q(S2a, "select public.start_attempt('ranked')")), "feature_disabled"));

// ══════════ L1 moderator ══════════
const fol = await q(SA1, "select * from public.l1_followers()");
ok("L1 moderator sees their followers: s2a in STA1", fol.length === 1 && fol[0].student_name === "s2a" && fol[0].subject_code === "STA1" && fol[0].student_space === "SDS L2");
ok("the list has no email/phone", !/email|phone/.test(Object.keys(fol[0]).join()));
ok("L1 moderator cannot read the remaining_subjects table", (await q(SA1, "select * from public.remaining_subjects")).length === 0);
ok("L1 moderator cannot delete the follow", ((await q(SA1, "delete from public.remaining_subjects returning 1")).length) === 0);
ok("a student cannot call l1_followers", has(await err(q(S2a, "select * from public.l1_followers()")), "forbidden"));
ok("a moderator of another major does not see SDS followers", (await q(SAD, "select * from public.l1_followers()")).length === 0);

// ══════════ Removal and moving ══════════
ok("L2 moderator sees their students' remaining subjects", (await q(SA2, "select * from public.remaining_subjects")).length === 1);
await q(SA2, "delete from public.remaining_subjects where student_id=$1", [S2a]);
ok("after removal: the content disappears immediately", (await q(S2a, "select id from public.lessons where id=$1", [lessonPub])).length === 0 && (await q(S2a, "select id from public.subjects where code='STA1'")).length === 0);
await q(SA2, "insert into public.remaining_subjects (student_id, subject_id) values ($1,$2)", [S2a, subA]);
await db.query("update public.profiles set cohort_id=$1 where id=$2", [IAA, S2a]);
ok("moving the student to another space drops their remaining subjects", (await n("select count(*) c from public.remaining_subjects where student_id=$1", [S2a])) === 0);

// ══════════ PDF limit and storage ══════════
ok("no file size limit in the table (a 200MB PDF is accepted)", !(await err(db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','big.pdf',$2,209715200)", [lessonB, `${lessonB}/big.pdf`]))));
await db.query("delete from public.lesson_files where name='big.pdf'");
ok("a 15MB PDF is accepted", !(await err(db.query("insert into public.lesson_files (lesson_id, kind, name, storage_path, size_bytes) values ($1,'pdf','ok.pdf',$2,15728640)", [lessonB, `${lessonB}/ok.pdf`]))));
ok("bucket limit is 50MB (the per-object maximum; larger files are split)", Number((await one("select file_size_limit from storage.buckets where id='lesson-files'")).file_size_limit) === 52428800);
const su = (await q(ADM, "select public.storage_usage() as d"))[0].d;
const sds1 = su.by_space.find((s) => s.name === "SDS L1");
ok("storage usage: total = sum of sizes", Number(su.total_bytes) === 5000000 + 15728640 && su.files === 2, JSON.stringify(su));
ok("per-space usage: SDS L1 holds all the files", Number(sds1.bytes) === Number(su.total_bytes) && su.by_space.length === 1);
ok("storage_usage is for the super admin only", has(await err(q(SA1, "select public.storage_usage()")), "forbidden") && has(await err(q(S2b, "select public.storage_usage()")), "forbidden") && denied(await err(anon("select public.storage_usage()"))));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
