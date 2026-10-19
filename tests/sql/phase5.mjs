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

// ── profiles.locale
ok("locale افتراضي ar", (await q(A, "select locale from public.profiles where id=$1", [A]))[0].locale === "ar");
for (const l of ["fr", "en", "ar"]) {
  const e = await err(q(A, "update public.profiles set locale=$2 where id=$1", [A, l]));
  const v = (await q(A, "select locale from public.profiles where id=$1", [A]))[0].locale;
  ok(`الطالب يغيّر لغته إلى ${l}`, !e && v === l, e);
}
ok("لغة غير مدعومة (de) مرفوضة", /check constraint/i.test((await err(q(A, "update public.profiles set locale='de' where id=$1", [A]))) ?? ""));
ok("قيمة فارغة مرفوضة", /check|not-null|null value/i.test((await err(q(A, "update public.profiles set locale='' where id=$1", [A]))) ?? ""));

// ── conversations.lang
const conv = (lang) => q(A, "insert into public.conversations (subject_id, mode, guided, lang, title) values ($1,'explain',true,$2,'t') returning lang", [S1, lang]);
for (const l of ["fr", "ar", "en"]) {
  let r, e = null; try { r = await conv(l); } catch (x) { e = x.message; }
  ok(`جلسة بلغة ${l}`, !e && r[0].lang === l, e);
}
ok("لغة جلسة غير مدعومة (de) مرفوضة", /check constraint/i.test((await err(conv("de"))) ?? ""));
ok("الافتراضي fr للجلسات", (await q(A, "insert into public.conversations (subject_id, mode, title) values ($1,'explain','t2') returning lang", [S1]))[0].lang === "fr");

// ── القيود موجودة باسم واحد ثابت (لا قيود مكررة بعد التشغيل مرتين)
const cons = (await db.query(`select conrelid::regclass::text t, conname from pg_constraint where contype='c' and conrelid in ('public.profiles'::regclass,'public.conversations'::regclass) and (pg_get_constraintdef(oid) ~* '\\mlocale\\M' or pg_get_constraintdef(oid) ~* '\\mlang\\M')`)).rows;
ok("قيد واحد لكل عمود", cons.length === 2 && cons.some(c => c.conname === "profiles_locale_check") && cons.some(c => c.conname === "conversations_lang_check"), JSON.stringify(cons));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
