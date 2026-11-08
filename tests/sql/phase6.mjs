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
const ADM = await mk("ADM", "admin");


const sel = (u) => q(u, "select code, start_date::text as d from public.semesters order by code");
ok("S3 = 2026-10-12", (await sel(A)).find((r) => r.code === "S3")?.d === "2026-10-12");
ok("S4 has no date (null)", (await sel(A)).find((r) => r.code === "S4")?.d === null);
ok("a student reads the date", (await sel(A)).length >= 2);
// A student cannot edit (RLS: zero rows)
const r1 = await q(A, "update public.semesters set start_date='2026-01-01' where code='S3' returning id");
ok("a student cannot edit the semester date", r1.length === 0 && (await sel(A)).find((r) => r.code === "S3").d === "2026-10-12");
// The admin can edit
const r2 = await q(ADM, "update public.semesters set start_date='2026-10-19' where code='S3' returning id");
ok("the admin edits the date", r2.length === 1 && (await sel(A)).find((r) => r.code === "S3").d === "2026-10-19");
ok("the admin clears it (null)", (await q(ADM, "update public.semesters set start_date=null where code='S4' returning id")).length === 1);
// Re-running 0015 does not overwrite the admin's edit (S3 = 19 October), but it fills in an empty value
await db.exec(fs.readFileSync(M + "0015_semester_start.sql", "utf8"));
ok("re-running 0015 does not overwrite the admin's edit", (await sel(A)).find((r) => r.code === "S3").d === "2026-10-19");
await db.query("update public.semesters set start_date=null where code='S3'");
await db.exec(fs.readFileSync(M + "0015_semester_start.sql", "utf8"));
ok("and fills the empty S3 with 2026-10-12", (await sel(A)).find((r) => r.code === "S3").d === "2026-10-12");
ok("S4 stays empty", (await sel(A)).find((r) => r.code === "S4").d === null);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
