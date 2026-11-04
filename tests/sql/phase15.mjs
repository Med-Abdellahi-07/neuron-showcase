// 0027 فضاء واحد (IAA L2) + 0028 ملفات مجزّأة (بيان الأجزاء وسياسة القراءة)
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


const cstate = async (maj, lvl) => one("select c.is_active, c.plan, c.features from public.cohorts c join public.majors m on m.id=c.major_id where m.code=$1 and c.level_code=$2", [maj, lvl]);
const iaa = await cstate("IAA", "L2");
ok("IAA L2 نشط بالخطة الكاملة", iaa.is_active && iaa.plan === "full");
ok("كل الميزات مفعّلة (بما فيها chat وai)", ["ai","arena","ranking","duel","review","recordings","qcm_pdf","written","chat"].every((k) => iaa.features[k] === true));
ok("لا فضاء آخر نشط", (await n("select count(*) c from public.cohorts where is_active and id <> $1", [IAA])) === 0);
ok("لا حذف: الفضاءات الأخرى وحساباتها باقية", (await n("select count(*) c from public.cohorts")) > 1 && (await n("select count(*) c from public.profiles where cohort_id=$1", [SDS2])) === 1);
const dir = (await anon("select public.public_directory() d"))[0].d;
const opens = dir.institutions.flatMap((i) => i.majors.flatMap((m) => m.spaces.filter((s) => s.open)));
ok("public_directory: IAA L2 وحده مفتوح", opens.length === 1 && opens[0].id === IAA);
ok("نسخة احتياطية محفوظة مرة واحدة", (await n("select count(*) c from public.single_space_backup where kind='cohort'")) === (await n("select count(*) c from public.cohorts")));
// المشرف العام → IAA L2
await db.query("insert into auth.users default values");
const adm = await mkP("adm", "admin", SDS2);
await db.exec(fs.readFileSync(M + "0027_single_space.sql", "utf8"));
ok("إعادة التشغيل تنقل المشرف العام إلى IAA L2", (await one("select cohort_id from public.profiles where id=$1", [adm])).cohort_id === IAA);
ok("النسخة الاحتياطية لا تُستبدل عند إعادة التشغيل", (await n("select count(*) c from public.single_space_backup where kind='cohort'")) === (await n("select count(*) c from public.cohorts")));
// التراجع
await db.exec(fs.readFileSync(M + "0027_single_space_down.sql.txt", "utf8"));
ok("التراجع يعيد حالة الفضاءات (SDS L2 كما كان قبل 0027)", (await n("select count(*) c from public.cohorts c join public.single_space_backup b on b.id=c.id and b.kind='cohort' where c.is_active is distinct from b.is_active")) === 0);
await db.exec(fs.readFileSync(M + "0027_single_space.sql", "utf8"));
ok("إعادة تطبيق 0027 بعد التراجع تعيد الفضاء الواحد", (await n("select count(*) c from public.cohorts where is_active")) === 1);

// ───── 0028: الملفات المجزّأة ─────
const lessUnpub = (await one("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',2,'U','draft',$2) returning id", [subI, SAI])).id;
const hs = Array.from({ length: 3 }, () => "a".repeat(64));
const mkFile = (lesson, id, parts, extra = {}) => db.query(
  "insert into public.lesson_files (id, lesson_id, kind, name, storage_path, size_bytes, part_count, sha256, part_sha256) values ($1,$2,'pdf','big.pdf',$3,$4,$5,$6,$7)",
  [id, lesson, `${lesson}/${id}`, 110 * 1048576, parts, "sha" in extra ? extra.sha : (parts > 1 ? "b".repeat(64) : null), "hs" in extra ? extra.hs : (parts > 1 ? hs.slice(0, parts) : null)]);
ok("ملف عادي part_count=1 افتراضياً", await (async () => { const id = U(); await db.query("insert into public.lesson_files (id, lesson_id, kind, name, storage_path, size_bytes) values ($1,$2,'pdf','x.pdf',$3,10)", [id, lessI, `${lessI}/x.pdf`]); return (await one("select part_count from public.lesson_files where id=$1", [id])).part_count === 1; })());
ok("مجزّأ بلا بصمات مرفوض", /lesson_files_parts_chk/.test(await err(mkFile(lessI, U(), 3, { sha: null, hs: null })) ?? ""));
ok("عدد البصمات يطابق عدد الأجزاء", /lesson_files_parts_chk/.test(await err(mkFile(lessI, U(), 3, { hs: hs.slice(0, 2) })) ?? ""));
const F = U(); await mkFile(lessI, F, 3);
ok("ملف مجزّأ صالح يُقبل (110MB بلا حد حجم)", (await one("select size_bytes, part_count from public.lesson_files where id=$1", [F])).size_bytes == 110 * 1048576);
const FU = U(); await mkFile(lessUnpub, FU, 3);
const obj = (path) => db.query("insert into storage.objects (bucket_id, name) values ('lesson-files', $1)", [path]);
for (let i = 1; i <= 3; i++) { await obj(`${lessI}/${F}/part-00${i}`); await obj(`${lessUnpub}/${FU}/part-00${i}`); }
const canRead = async (u, path) => (await q(u, "select count(*) c from storage.objects where bucket_id='lesson-files' and name=$1", [path]))[0].c == 1;
ok("طالب IAA L2 يقرأ أجزاء ملف منشور", (await canRead(A, `${lessI}/${F}/part-001`)) && (await canRead(A, `${lessI}/${F}/part-003`)));
ok("طالب فضاء آخر لا يقرأها", !(await canRead(S, `${lessI}/${F}/part-001`)));
ok("أجزاء درس غير منشور مخفية عن الطالب", !(await canRead(A, `${lessUnpub}/${FU}/part-001`)));
ok("المشرف يقرأ أجزاء غير المنشور", await canRead(SAI, `${lessUnpub}/${FU}/part-002`));
ok("جزء خارج بيان الملف مخفي عن الطالب", await (async () => { await obj(`${lessI}/${F}/stray.bin`); return !(await canRead(A, `${lessI}/${F}/stray.bin`)); })());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
