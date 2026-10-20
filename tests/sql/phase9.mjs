// الدفعة ب: لوحات الإحصاء (الجامعة والفضاء) وحدودها
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

await run(files);
const mkUser = async () => (await db.query("insert into auth.users default values returning id")).rows[0].id;
const mkP = async (name, role, cohort, seen = null) => { const id = await mkUser(); await db.query("insert into public.profiles (id, full_name, role, cohort_id, last_seen_at) values ($1,$2,$3,$4,$5)", [id, name, role, cohort, seen]); return id; };
const space = async (maj, lvl) => (await one("select c.id from public.cohorts c join public.majors m on m.id=c.major_id where m.code=$1 and c.level_code=$2", [maj, lvl])).id;
const IAA = await space("IAA", "L2"), SDS1 = await space("SDS", "L1"), SDS2 = await space("SDS", "L2");

const ADM = await mkP("ADM", "admin", IAA);
const SA1 = await mkP("SA1", "space_admin", SDS1, new Date().toISOString());
const SA2 = await mkP("SA2", "space_admin", SDS2);
const S1a = await mkP("s1a", "student", SDS1, new Date().toISOString());
const S1b = await mkP("s1b", "student", SDS1);
const S2a = await mkP("s2a", "student", SDS2, new Date(Date.now() - 3 * 864e5).toISOString());
const IA = await mkP("ia", "student", IAA, new Date().toISOString());
const sem1 = (await one("select id from public.semesters where cohort_id=$1 and is_current", [SDS1])).id;
const sub1 = (await one("insert into public.subjects (semester_id, code, name) values ($1,'STA1','Stat') returning id", [sem1])).id;
await db.query("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',1,'L1','published',$2)", [sub1, SA1]);
await db.query("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',2,'L2','pending',$2)", [sub1, SA1]);
await db.query("insert into public.questions (subject_id, type, difficulty, statement, options, correct_index, status, created_by) values ($1,'mcq','easy','q','[\"a\",\"b\"]',0,'published',$2)", [sub1, SA1]);

const d1 = (await q(SA1, "select public.space_dashboard() as d"))[0].d;
ok("لوحة SDS L1: عدد الطلاب 2 ولا تحسب غيرهم", d1.students === 2, JSON.stringify(d1));
ok("لوحة SDS L1: نشط اليوم 1، لم يدخل قط 1", d1.active_1d === 1 && d1.never_logged === 1);
ok("لوحة SDS L1: دروس منشورة 1 ومعلّقة 1، أسئلة 1، مواد 1", d1.lessons_published === 1 && d1.lessons_pending === 1 && d1.questions_published === 1 && d1.subjects === 1);
ok("لوحة SDS L1: المشرفون = SA1 فقط (لا SA2)", d1.staff.length === 1 && d1.staff[0].id === SA1);
ok("لوحة SDS L1 لا تحوي طلاب فضاء آخر", !JSON.stringify(d1).includes("s2a") && !JSON.stringify(d1).includes('"ia"'));
const d2 = (await q(SA2, "select public.space_dashboard() as d"))[0].d;
ok("لوحة SDS L2 مستقلة: طالب واحد وبلا دروس", d2.students === 1 && d2.lessons_published === 0 && d2.active_7d === 1);
ok("طالب لا يستدعي space_dashboard", has(await err(q(S1a, "select public.space_dashboard()")), "forbidden"));
ok("المشرف العام داخل فضاء SDS L1 يرى لوحته", (await (async () => { await db.query("update public.profiles set cohort_id=$1 where id=$2", [SDS1, ADM]); return (await q(ADM, "select public.space_dashboard() as d"))[0].d.students; })()) === 2);
await db.query("update public.profiles set cohort_id=$1 where id=$2", [IAA, ADM]);

ok("مشرف فضاء لا يستدعي admin_overview", has(await err(q(SA1, "select public.admin_overview()")), "forbidden"));
ok("طالب لا يستدعي admin_overview", has(await err(q(S1a, "select public.admin_overview()")), "forbidden"));
ok("anon لا يستدعي أياً من الدالتين", denied(await err(anon("select public.admin_overview()"))) && denied(await err(anon("select public.space_dashboard()"))));
const ov = (await q(ADM, "select public.admin_overview() as d"))[0].d;
const row = (name) => ov.spaces.find((s) => s.name === name);
ok("نظرة الجامعة: 24 فضاءً على الأقل مع L1+L2 للتخصصات الـ12", ov.spaces.length >= 24, String(ov.spaces.length));
ok("نظرة الجامعة: SDS L1 = 2 طالب، مشرف 1، دروس 1، أسئلة 1", row("SDS L1").students === 2 && row("SDS L1").supervisors === 1 && row("SDS L1").lessons === 1 && row("SDS L1").questions === 1);
ok("نظرة الجامعة: IAA L2 = طالب واحد، والمؤسسة FST", row("IAA L2").students === 1 && row("IAA L2").institution === "FST");
ok("نظرة الجامعة: آخر محتوى للفضاء الذي رُفع فيه فقط", row("SDS L1").last_content_at !== null && row("SDS L2").last_content_at === null);
const sup = ov.supervisors.find((s) => s.id === SA1);
ok("نشاط المشرفين: SA1 له آخر دخول وآخر رفع، وSA2 بلا نشاط", sup && sup.last_seen_at && sup.last_upload_at && ov.supervisors.find((s) => s.id === SA2).last_upload_at === null);
ok("نظرة الجامعة لا تحوي بريداً ولا هاتفاً", !/email|phone/.test(JSON.stringify(ov)));

console.log(`\n${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
