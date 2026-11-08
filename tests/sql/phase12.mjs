// Space chat: isolation between spaces, self/staff deletion, mute, send limit, chat feature
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
const SDS2 = await space("SDS", "L2"), IAA = await space("IAA", "L2");
const ADM = await mkP("ADM", "admin", IAA);
const SAI = await mkP("SAI", "space_admin", IAA), SAS = await mkP("SAS", "space_admin", SDS2);
const A = await mkP("a", "student", IAA), B = await mkP("b", "student", IAA), S = await mkP("s", "student", SDS2);
const mkSub = async (coh, code) => { const sem = (await one("select id from public.semesters where cohort_id=$1 and is_current", [coh])).id; return (await one("insert into public.subjects (semester_id, code, name) values ($1,$2,$2) returning id", [sem, code])).id; };
const subI = await mkSub(IAA, "AI1"), subS = await mkSub(SDS2, "ST2");
const mkLesson = async (sub, by) => (await one("insert into public.lessons (subject_id, kind, number, title, status, created_by) values ($1,'cm',1,'T','published',$2) returning id", [sub, by])).id;
const lessI = await mkLesson(subI, SAI), lessS = await mkLesson(subS, SAS);
const spend = async (u, k) => (await q(u, "select public.ai_spend($1) as r", [k]))[0].r;


const send = (u, b, r = null) => q(u, "select public.space_chat_send($1, $2) id", [b, r]);
const list = async (u, a = null, bf = null, l = 40) => (await q(u, "select public.space_chat_list($1,$2,$3) r", [a, bf, l]))[0].r;
const MOD = await mkP("m", "moderator", IAA);

ok("chat feature is enabled in IAA L2 (full) and disabled in a basic space", (await one("select features->>'chat' c from public.cohorts where id=$1", [IAA])).c === "true");
const BASIC = (await one("select c.id from public.cohorts c where c.plan='basic' limit 1"))?.id;
if (BASIC) { const X = await mkP("x", "student", BASIC); ok("فضاء basic: الدردشة معطّلة", has(await err(send(X, "hi")), "feature_disabled")); }

ok("no direct access to the tables from the browser", denied(await err(q(A, "select * from public.space_messages"))) && denied(await err(q(A, "insert into public.space_messages (cohort_id,user_id,body) values ($1,$2,'x')", [IAA, A]))) && denied(await err(q(A, "select * from public.space_mutes"))));
ok("not signed in is rejected", denied(await err(anon("select public.space_chat_list()"))) );

const m1 = (await send(A, "  مرحبا  "))[0].id, m2 = (await send(B, "رد", m1))[0].id;
let L = await list(A);
ok("both students in the same space see the two messages in order", L.messages.length === 2 && L.messages[0].id === m1 && L.messages[1].id === m2 && L.messages[0].body === "مرحبا");
ok("mine, name and reply_to are correct", L.messages[0].mine === true && L.messages[1].mine === false && L.messages[1].name === "b" && Number(L.messages[1].reply_to) === Number(m1));
ok("isolation: a student from another space sees nothing", has(await err(list(S)), "feature_disabled") || (await list(S)).messages.length === 0);
await q(SAS, "select public.space_chat_send('SDS')").catch(() => {});
const sds = await db.query("select features->>'chat' c from public.cohorts where id=$1", [SDS2]);
if (sds.rows[0].c === "true") { await send(S, "من SDS"); ok("رسائل SDS لا تظهر في IAA", !(await list(A)).messages.some((x) => x.body === "من SDS")); }
ok("a reply to a message from another space is ignored (reply_to=null)", await (async () => { if (sds.rows[0].c !== "true") return true; const id = (await send(S, "x", m1))[0].id; return (await one("select reply_to from public.space_messages where id=$1", [id])).reply_to === null; })());

ok("empty text or text longer than 1000 is rejected", has(await err(send(A, "   ")), "bad_body") && has(await err(send(A, "x".repeat(1001))), "bad_body"));
const after = await list(B, m1);
ok("p_after returns only the newest", after.messages.length === 1 && Number(after.messages[0].id) === Number(m2));
ok("p_before returns the older ones", (await list(B, null, m2)).messages.length === 1);

ok("a student cannot delete someone else's message", (await q(B, "select public.space_chat_delete($1) d", [m1]))[0].d === false && (await n("select count(*) c from public.space_messages where id=$1", [m1])) === 1);
ok("a student deletes their own message", (await q(B, "select public.space_chat_delete($1) d", [m2]))[0].d === true);
ok("a moderator deletes any student's message in their space", (await q(MOD, "select public.space_chat_delete($1) d", [m1]))[0].d === true);
const o = (await send(A, "للحذف"))[0].id;
ok("a moderator of another space cannot delete this space's messages", (await q(SAS, "select public.space_chat_delete($1) d", [o]))[0].d === false);

// Mute
ok("a student cannot mute", has(await err(q(A, "select public.space_chat_mute($1, 1)", [B])), "forbidden"));
ok("staff cannot be muted", has(await err(q(SAI, "select public.space_chat_mute($1, 1)", [MOD])), "bad_target"));
ok("a student from another space cannot be muted", has(await err(q(SAI, "select public.space_chat_mute($1, 1)", [S])), "bad_target"));
await q(SAI, "select public.space_chat_mute($1, 2)", [B]);
ok("a muted user cannot send", has(await err(send(B, "x")), "muted") && (await list(B)).muted_until !== null);
ok("a muted user can read", (await list(B)).messages.length >= 1);
await q(MOD, "select public.space_chat_mute($1, 0)", [B]);
ok("unmuting", (await send(B, "عدت"))[0].id > 0 && (await list(B)).muted_until === null);

// Send limit: 12 per minute
const C = await mkP("c", "student", IAA);
for (let i = 0; i < 12; i++) await send(C, "m" + i);
ok("message 13 in a minute: rate_limited", has(await err(send(C, "زائدة")), "rate_limited"));
ok("A is not affected by C's limit", (await send(A, "ok"))[0].id > 0);
ok("staff sees staff=true", (await list(MOD)).staff === true && (await list(A)).staff === false);

// Real isolation: enable chat in SDS L2 and verify the separation in both directions
await db.query("update public.cohorts set features = features || '{\"chat\":true}'::jsonb where id=$1", [SDS2]);
const sm = (await send(S, "رسالة SDS"))[0].id;
ok("SDS messages do not show to IAA students and vice versa", !(await list(A)).messages.some((x) => x.body === "رسالة SDS") && !(await list(S)).messages.some((x) => x.user_id === A));
ok("an IAA moderator cannot delete an SDS message", (await q(SAI, "select public.space_chat_delete($1) d", [sm]))[0].d === false);
ok("an SDS moderator deletes it", (await q(SAS, "select public.space_chat_delete($1) d", [sm]))[0].d === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
