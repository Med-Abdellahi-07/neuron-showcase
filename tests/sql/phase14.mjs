// مزامنة نتائج QCM بدون إنترنت: record_offline_scores
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
const denied = (m) => /permission denied|row-level security|not_authenticated/.test(m ?? "");
const n = async (sql, p = []) => Number((await db.query(sql, p)).rows[0].c);
const one = async (sql, p = []) => (await db.query(sql, p)).rows[0];
const mkUser = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const mkP = async (name, role, cohort) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const space = async (maj, lvl) => (await one("select c.id from public.cohorts c join public.majors m on m.id=c.major_id where m.code=$1 and c.level_code=$2", [maj, lvl])).id;
const SDS2 = await space("SDS", "L2"), IAA = await space("IAA", "L2");
const A = await mkP("a", "student", IAA), S = await mkP("s", "student", SDS2), SAI = await mkP("sai", "space_admin", IAA);
const mkSub = async (coh, code) => { const sem = (await one("select id from public.semesters where cohort_id=$1 and is_current", [coh])).id; return (await one("insert into public.subjects (semester_id, code, name) values ($1,$2,$2) returning id", [sem, code])).id; };
const subI = await mkSub(IAA, "AI1"), subS = await mkSub(SDS2, "ST2");
const mkLesson = async (sub, by) => (await one("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',1,'T','published',$2) returning id", [sub, by])).id;
const lessI = await mkLesson(subI, SAI), lessS = await mkLesson(subS, SAI);
const U = () => crypto.randomUUID();
const row = (o = {}) => ({ client_id: U(), lesson_id: lessI, correct: 7, total: 10, taken_at: new Date().toISOString(), ...o });
const rec = (u, rows) => q(u, "select public.record_offline_scores($1::jsonb) r", [JSON.stringify(rows)]);

ok("anon ممنوع", denied(await err(anon("select public.record_offline_scores('[]'::jsonb)"))));
ok("الطالب لا يقرأ الجدول مباشرة", denied(await err(q(A, "select * from public.offline_scores"))));
ok("ولا يكتب فيه مباشرة", denied(await err(q(A, "insert into public.offline_scores (client_id,user_id,correct,total,taken_at) values (gen_random_uuid(), $1, 1, 2, now())", [A]))));

const r1 = row();
const out = (await rec(A, [r1]))[0].r;
ok("نتيجة صحيحة تُقبل وتُرجَع", out.length === 1 && out[0] === r1.client_id && (await n("select count(*) c from public.offline_scores")) === 1);
ok("إعادة الإرسال لا تكرر (idempotent)", ((await rec(A, [r1]))[0].r.length === 1) && (await n("select count(*) c from public.offline_scores")) === 1);
ok("user_id وcohort_id من الجلسة لا من الطلب", (await one("select user_id, cohort_id from public.offline_scores")).user_id === A);
const bad = [row({ correct: 11 }), row({ total: 0 }), row({ total: 51 }), row({ correct: -1 }), row({ taken_at: new Date(Date.now() + 3600e3).toISOString() }), row({ taken_at: new Date(Date.now() - 100 * 86400e3).toISOString() })];
const outBad = (await rec(A, bad))[0].r;
ok("القيم غير المعقولة تُعالج ولا تُخزَّن", outBad.length === bad.length && (await n("select count(*) c from public.offline_scores")) === 1);
ok("صف تالف لا يُسقط الدفعة", (await rec(A, [{ client_id: "x", correct: "a" }, row()]))[0].r.length === 1 && (await n("select count(*) c from public.offline_scores")) === 2);
const rx = row({ lesson_id: lessS });
await rec(A, [rx]);
ok("حصة من فضاء آخر تُسجَّل بلا ربط", (await one("select lesson_id from public.offline_scores where client_id=$1", [rx.client_id])).lesson_id === null);
ok("حصة من فضاء الطالب تُربط", (await one("select lesson_id from public.offline_scores where client_id=$1", [r1.client_id])).lesson_id === lessI);
ok("أكثر من 100 مرفوض", (await err(rec(A, Array.from({ length: 101 }, () => row())))) !== null);
ok("لا خلط بين المستخدمين (نفس client_id لمستخدمين)", (await rec(S, [{ ...r1, lesson_id: null }]))[0].r.length === 1 && (await n("select count(*) c from public.offline_scores where client_id=$1", [r1.client_id])) === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
