import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import fs from "node:fs";
const M = new URL("../../supabase/migrations/", import.meta.url).pathname;
const db = new PGlite({ extensions: { vector } });
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage; create function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid); alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated, service_role; grant all on all tables in schema storage to authenticated;
`);
const files = fs.readdirSync(M).filter((f) => f.endsWith(".sql")).sort();
for (const f of files) { await db.exec(fs.readFileSync(M + f, "utf8")); if (!/0001|0002|0003/.test(f)) await db.exec(fs.readFileSync(M + f, "utf8")); }
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n} ${c ? "" : x}`); };
async function as(user, role, fn) {
  await db.exec("begin"); await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user ?? ""]);
  try { const r = await fn(); await db.exec("commit"); return r; } catch (e) { await db.exec("rollback"); throw e; }
}
const q = (u, sql, p = []) => as(u, "authenticated", async () => (await db.query(sql, p)).rows);
const anon = (sql, p = []) => as(null, "anon", async () => (await db.query(sql, p)).rows);
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const denied = (m) => /permission denied|row-level security|forbidden|not_authenticated/.test(m ?? "");

const cohort = (await db.query("select id from public.cohorts order by (name = 'IAA L2') desc, created_at limit 1")).rows[0].id;
const sem = (await db.query("select id from public.semesters where is_current and cohort_id = $1 limit 1", [cohort])).rows[0].id;
const S1 = (await db.query("select id from public.subjects where semester_id=$1 order by sort limit 1", [sem])).rows[0].id;
const mk = async (name, role = "student") => { const id = (await db.query("insert into auth.users default values returning id")).rows[0].id; await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const A = await mk("A");
const B = await mk("B");
const ADM = await mk("ADM", "admin");


const S2 = (await db.query("select id from public.subjects where semester_id=$1 order by sort offset 1 limit 1", [sem])).rows[0].id;
const lesson = async (sid, kind, number) => (await db.query("insert into public.lessons (subject_id, kind, number, title, status) values ($1,$2,$3,$4,'published') returning id", [sid, kind, number, `${kind}${number}`])).rows[0].id;
const L1 = await lesson(S1, "cm", 1), L2 = await lesson(S1, "cm", 2), L3 = await lesson(S1, "cm", 3);
const mq = (sid, lid, st, { diff = "medium", status = "published", type = "mcq", exam = false, expl = null } = {}) =>
  db.query(`insert into public.questions (subject_id, lesson_id, type, difficulty, statement, options, correct_index, model_answer, explanation, status, exam_only)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [sid, lid, type, diff, st, type === "mcq" ? JSON.stringify(["a", "b", "c", "d"]) : null, type === "mcq" ? 2 : null, type === "written" ? "m" : null, expl, status, exam]);
for (let i = 1; i <= 6; i++) await mq(S1, L1, `L1-${i}`, { diff: i <= 3 ? "easy" : "hard", expl: `expl-${i}` });
for (let i = 1; i <= 3; i++) await mq(S1, L2, `L2-${i}`);
await mq(S1, L3, "L3-1");
await mq(S1, L1, "EXAM-ONLY", { exam: true });
await mq(S1, L1, "DRAFT", { status: "draft" });
await mq(S1, L1, "WRITTEN", { type: "written" });
const exp = (u, args) => q(u, "select public.qcm_export($1,$2,$3,$4,$5,$6,$7,$8) as r", args).then((r) => r[0].r);
const stm = (r) => r.questions.map((x) => x.statement);

// -- Column and privileges
ok("exam_only defaults to false", (await db.query("select exam_only from public.questions where statement='L1-1'")).rows[0].exam_only === false);
ok("a student cannot read correct_index", denied(await err(q(A, "select correct_index from public.questions limit 1"))));
ok("a student cannot read explanation", denied(await err(q(A, "select explanation from public.questions limit 1"))));
ok("a student cannot select *", denied(await err(q(A, "select * from public.questions limit 1"))));
ok("exam_only is readable (not sensitive)", !(await err(q(A, "select exam_only from public.questions limit 1"))));
ok("the admin edits exam_only", (await q(ADM, "update public.questions set exam_only=true where statement='L3-1' returning id")).length === 1);
await q(ADM, "update public.questions set exam_only=false where statement='L3-1'");
ok("a student cannot edit exam_only (RLS)", (await q(A, "update public.questions set exam_only=true where statement='L3-1' returning id")).length === 0);

// ── qcm_export
let r = await exp(A, [S1, null, null, null, null, 50, false, false]);
ok("exam_only/draft/written questions do not show", !stm(r).some((s) => ["EXAM-ONLY", "DRAFT", "WRITTEN"].includes(s)) && r.questions.length === 10, JSON.stringify(stm(r)));
ok("order by lesson, no mixing", stm(r).slice(0, 3).join() === "L1-1,L1-2,L1-3" || stm(r)[0].startsWith("L1"));
ok("question numbers 1..n", r.questions.every((x, i) => x.n === i + 1));
ok("the correct answer is returned", r.questions.every((x) => x.correct === 2));
ok("the explanation is hidden by default", r.questions.every((x) => x.explanation === null));
r = await exp(A, [S1, L1, null, null, null, 50, false, true]);
ok("lesson filter + explanation on request", r.questions.length === 6 && r.questions.every((x) => /^expl-/.test(x.explanation)) && r.lesson.number === 1 && r.lesson.kind === "cm");
r = await exp(A, [S1, null, 2, 3, null, 50, false, false]);
ok("lesson range 2..3", r.questions.length === 4 && stm(r).every((s) => /^L[23]/.test(s)), JSON.stringify(stm(r)));
r = await exp(A, [S1, null, null, null, "hard", 50, false, false]);
ok("difficulty filter", r.questions.length === 3 && stm(r).every((s) => /^L1-[456]/.test(s)));
r = await exp(A, [S1, null, null, null, null, 4, true, false]);
ok("count 4", r.questions.length === 4);
r = await exp(A, [S1, null, null, null, null, 1000, true, false]);
ok("maximum 50 (only 10 available here)", r.questions.length === 10);
const seen = new Set(); for (let i = 0; i < 4; i++) seen.add(stm(await exp(B, [S1, null, null, null, null, 10, true, false])).join()); 
ok("shuffling changes the order", seen.size > 1, [...seen].length);
const e0 = await err(exp(A, [S2, null, null, null, null, 10, true, false]));
ok("no questions -> no_questions", /no_questions/.test(e0 ?? ""), e0);

// -- Daily limit: 10 per student (has A used 6 successful so far?)
const cnt = async (u) => (await db.query("select count(*)::int c from public.qcm_downloads where user_id=$1", [u])).rows[0].c;
ok("no_questions is not counted", (await cnt(A)) === 6, await cnt(A));
for (let i = (await cnt(A)); i < 10; i++) await exp(A, [S1, L1, null, null, null, 5, true, false]);
ok("10 downloads are allowed", (await cnt(A)) === 10);
const lim = await err(exp(A, [S1, null, null, null, null, 5, true, false]));
ok("the 11th is rejected: download_limit", /download_limit/.test(lim ?? ""), lim);
ok("another student is not affected", !(await err(exp(B, [S1, null, null, null, null, 5, true, false]))));
await db.query("update public.qcm_downloads set created_at = now() - interval '25 hours' where user_id=$1", [A]);
ok("after 24 hours it is allowed again", !(await err(exp(A, [S1, null, null, null, null, 5, true, false]))));

// -- Protection
ok("anon cannot run qcm_export", denied(await err(anon("select public.qcm_export()"))));
ok("a student cannot read qcm_downloads", denied(await err(q(A, "select * from public.qcm_downloads"))));
ok("a student cannot write to qcm_downloads", denied(await err(q(A, "insert into public.qcm_downloads (user_id) values ($1)", [A]))));
ok("a student cannot delete the download log", denied(await err(q(A, "delete from public.qcm_downloads"))));

// -- Free practice excludes exam_only; the ranked quiz includes it
for (let i = 1; i <= 5; i++) await mq(S2, null, `EX-${i}`, { exam: true });
const free = await err(q(A, "select public.start_attempt('free',$1,null,null,null,null,'mcq',10,0)", [S2]));
ok("free practice does not find exam_only", /no_questions/.test(free ?? ""), free);
const rk = await err(q(B, "select public.start_attempt('ranked',$1,null,null,null,null,'mcq',20,20)", [S2]));
ok("the ranked quiz includes exam_only", !rk, rk);
const used = (await db.query("select question_ids from public.attempts where user_id=$1 and mode='ranked' order by started_at desc limit 1", [B])).rows[0].question_ids;
ok("and they are actually picked", used.length === 5);
const fr = await q(A, "select public.start_attempt('free',$1,null,null,null,null,'mcq',50,0) as id", [S1]);
const ids = (await db.query("select question_ids from public.attempts where id=$1", [fr[0].id])).rows[0].question_ids;
const flagged = (await db.query("select count(*)::int c from public.questions where id = any($1) and exam_only", [ids])).rows[0].c;
ok("free practice on a subject containing exam_only does not include them", ids.length > 0 && flagged === 0);

// -- Re-running 0016 is safe
await db.exec(fs.readFileSync(M + "0016_qcm_pdf.sql", "utf8"));
ok("re-running 0016 is safe", !(await err(exp(B, [S1, null, null, null, null, 5, true, false]))));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
