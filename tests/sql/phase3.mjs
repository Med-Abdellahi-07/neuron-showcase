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
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };

const cohort = (await db.query("select id from public.cohorts order by (name = 'IAA L2') desc, created_at limit 1")).rows[0].id;
const sem = (await db.query("select id from public.semesters where is_current and cohort_id = $1 limit 1", [cohort])).rows[0].id;
const S1 = (await db.query("select id from public.subjects where semester_id=$1 order by sort limit 1", [sem])).rows[0].id;
const mk = async (name, role = "student") => { const id = (await db.query("insert into auth.users default values returning id")).rows[0].id; await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, cohort]); return id; };
const A = await mk("A"), B = await mk("B"), ADM = await mk("Adm", "admin");

// ── anon
const anon = (sql) => as(null, "anon", async () => (await db.query(sql)).rows);
ok("anon: ping is allowed", (await anon("select public.ping()")).length === 1);
for (const f of ["public.is_admin()", "public.is_staff()", "public.my_cohort()", "public.can_publish_direct()", "public.base_points('easy')", "public.ai_take('x',1,1,1)", "public.my_stats()"])
  ok(`anon: ${f} is forbidden`, /permission denied/.test(await err(anon(`select ${f}`)) ?? ""));
ok("anon: lesson_chunks is forbidden", /permission denied/.test(await err(anon("select * from public.lesson_chunks")) ?? ""));
ok("authenticated: is_admin works", (await q(ADM, "select public.is_admin() a"))[0].a === true);
ok("RLS on profiles still works", (await q(A, "select id from public.profiles")).length === 1);

// ── RAG
const lessonPub = (await db.query("insert into public.lessons (subject_id,kind,number,title,status) values ($1,'cm',1,'Intro','published') returning id", [S1])).rows[0].id;
const lessonDraft = (await db.query("insert into public.lessons (subject_id,kind,number,title,status) values ($1,'cm',2,'Draft','draft') returning id", [S1])).rows[0].id;
const fid = async (l) => (await db.query("insert into public.lesson_files (lesson_id,kind,name,storage_path) values ($1,'pdf','a.pdf',$2) returning id", [l, "p" + Math.random()])).rows[0].id;
const [F1, F2] = [await fid(lessonPub), await fid(lessonDraft)];
const vec = (i) => "[" + Array.from({ length: 768 }, (_, k) => (k === i ? 1 : 0)).join(",") + "]";
const ins = (l, f, page, text, i) => db.query("insert into public.lesson_chunks (lesson_id,file_id,subject_id,page,chunk_index,content,embedding) values ($1,$2,$3,$4,0,$5,$6)", [l, f, S1, page, text, vec(i)]);
await ins(lessonPub, F1, 1, "La régression linéaire minimise l'erreur quadratique moyenne.", 0);
await ins(lessonPub, F1, 2, "Les arbres de décision utilisent l'entropie pour diviser les noeuds.", 1);
await ins(lessonDraft, F2, 1, "Contenu secret non publié sur la régression.", 0);
const mc = await q(A, "select * from public.match_chunks($1::extensions.vector, null, null, 5)", [vec(1)]);
ok("match_chunks: nearest first with the lesson data", mc.length === 2 && mc[0].page === 2 && mc[0].lesson_number === 1 && mc[0].subject_code, JSON.stringify(mc.map((r) => r.page)));
ok("match_chunks: a student does not see a draft", !mc.some((r) => r.lesson_id === lessonDraft));
ok("match_chunks: the admin sees the draft", (await q(ADM, "select * from public.match_chunks($1::extensions.vector, null, null, 5)", [vec(0)])).length === 3);
ok("match_chunks: filter by lesson", (await q(A, "select * from public.match_chunks($1::extensions.vector, null, $2, 5)", [vec(0), lessonPub])).length === 2);
const tx = await q(A, "select * from public.search_chunks_text('régression', null, null, 5)");
await ins(lessonPub, F1, 3, "4. L'apprentissage supervisé consiste à apprendre une fonction à partir d'exemples étiquetés.", 2);
const tq = await q(A, "select * from public.search_chunks_text($1, null, null, 5)", ["Qu'est-ce que l'apprentissage supervisé selon le cours ?"]);
ok("0006: a long question (OR) finds the apprentissage supervisé section", tq.length >= 1 && tq[0].page === 3, JSON.stringify(tq.map((r) => r.page)));
ok("0006: stop words only do not throw an error", (await q(A, "select * from public.search_chunks_text('le la de', null, null, 5)")).length === 0);
ok("0006: anon cannot run the text search", /permission denied/.test(await err(anon("select * from public.search_chunks_text('x',null,null,3)")) ?? ""));
const lw = await q(A, "select * from public.lesson_window($1, '{}', 0, 10)", [S1]);
ok("0007: lesson_window in order with the total chunks, no drafts", lw.length === 3 && lw.every((r, i) => r.ord === i && r.total === 3) && lw[0].page === 1 && lw[2].page === 3, JSON.stringify(lw.map((r) => [r.ord, r.page, r.total])));
ok("0007: start and limit", (await q(A, "select * from public.lesson_window($1, '{}', 1, 1)", [S1])).map((r) => r.page).join() === "2");
ok("0007: selecting a specific lesson", (await q(ADM, "select * from public.lesson_window($1, $2::uuid[], 0, 10)", [S1, `{${lessonDraft}}`])).length === 1);
ok("0007: anon is forbidden", /permission denied/.test(await err(anon("select * from public.lesson_window(null,'{}',0,1)")) ?? ""));
ok("0007: the new conversation columns are writable by the owner", (await q(A, "insert into public.conversations (mode, lesson_ids, cursor, total, step, guided) values ('explain', $1::uuid[], 2, 9, 1, true) returning cursor", [`{${lessonPub}}`]))[0].cursor === 2);
ok("French text search (with stemming) finds only the published chunk", tx.length === 1 && tx[0].page === 1 && tx[0].lesson_id === lessonPub, JSON.stringify(tx));
ok("a student cannot write to lesson_chunks", /permission denied/.test(await err(q(A, "insert into public.lesson_chunks (lesson_id,file_id,subject_id,page,chunk_index,content) values ($1,$2,$3,1,0,'x')", [lessonPub, F1, S1])) ?? ""));

// -- Conversations
const conv = (await q(A, "insert into public.conversations (subject_id, mode, title) values ($1,'solve','t') returning id", [S1]))[0].id;
await q(A, "insert into public.messages (conversation_id, role, content, sources) values ($1,'user','Q',null)", [conv]);
ok("conversations and messages belong to their owner", (await q(A, "select * from public.messages")).length === 1);
ok("another student cannot see the conversation", (await q(B, "select * from public.conversations")).length === 0 && (await q(B, "select * from public.messages")).length === 0);
ok("another student cannot write to someone else's conversation", /row-level security/.test(await err(q(B, "insert into public.messages (conversation_id, role, content) values ($1,'user','hack')", [conv])) ?? ""));
ok("the admin cannot read students' conversations (privacy)", (await q(ADM, "select * from public.conversations")).length === 0);

// -- Limits
const takes = [];
for (let i = 0; i < 5; i++) takes.push((await q(A, "select public.ai_take('chat', 3, 600, 100) t"))[0].t);
ok("ai_take: allows 3 then refuses", JSON.stringify(takes) === "[true,true,true,false,false]", JSON.stringify(takes));
ok("ai_take: independent between students and types", (await q(B, "select public.ai_take('chat', 3, 600, 100) t"))[0].t && (await q(A, "select public.ai_take('grade', 3, 600, 100) t"))[0].t);
ok("ai_take: daily limit", !(await q(B, "select public.ai_take('day', 100, 600, 0) t"))[0].t);
ok("a student cannot read ai_usage", /permission denied/.test(await err(q(A, "select * from public.ai_usage")) ?? ""));

// -- Analysis and statistics
const Q1 = (await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,status) values ($1,'mcq','hard','Q hard',$2,0,'published') returning id", [S1, JSON.stringify(["a", "b"])])).rows[0].id;
const W1 = (await db.query("insert into public.questions (subject_id,type,difficulty,statement,model_answer,status) values ($1,'written','medium','Explain X','model','published') returning id", [S1])).rows[0].id;
const att = (await q(A, "select public.start_attempt('free', $1, null, null, null, null, 'mixed', 10, 0) id", [S1]))[0].id;
await q(A, "select public.submit_answer($1,$2,1,null,null)", [att, Q1]);
await q(A, "select public.submit_answer($1,$2,null,false,null)", [att, W1]);
await q(A, "select public.record_ai_grade($1,$2,35,'Partiel: il manque la définition')", [att, W1]);
const g = (await db.query("select ai_score, ai_feedback from public.attempt_answers where question_id=$1", [W1])).rows[0];
ok("record_ai_grade saves the grade and comment", g.ai_score === 35 && /Partiel/.test(g.ai_feedback));
await q(B, "select public.record_ai_grade($1,$2,99,'x')", [att, W1]);
ok("record_ai_grade: cannot edit someone else's answer", (await db.query("select ai_score from public.attempt_answers where question_id=$1", [W1])).rows[0].ai_score === 35);
const st = (await q(A, "select public.my_stats() s"))[0].s;
ok("my_stats: correct totals", st.answered === 2 && st.correct === 0 && st.by_subject.length === 1 && st.weak_questions.length === 2 && st.in_review === 2, JSON.stringify(st).slice(0, 300));
ok("my_stats: no personal data", !/"full_name"|@|phone/.test(JSON.stringify(st)));
ok("my_stats: a student cannot request someone else's", /forbidden/.test(await err(q(B, "select public.my_stats($1)", [A])) ?? ""));
ok("my_stats: the admin can request someone else's", (await q(ADM, "select public.my_stats($1) s", [A]))[0].s.answered === 2);
await q(A, "insert into public.student_analysis (user_id, content) values ($1,'نص')", [A]);
ok("student_analysis: its owner and the admin only", (await q(A, "select * from public.student_analysis")).length === 1 && (await q(ADM, "select * from public.student_analysis")).length === 1 && (await q(B, "select * from public.student_analysis")).length === 0);

// -- Answer protection still holds
ok("correct_index is still hidden after 0005", /permission denied/.test(await err(q(A, "select correct_index from public.questions")) ?? ""));
ok("explanation is still hidden", /permission denied/.test(await err(q(A, "select explanation from public.questions")) ?? ""));
ok("the old functions work after tightening (start_attempt/leaderboard)", (await q(A, "select * from public.leaderboard('week','UTC')")).length >= 0);
// A new function is not public by default
await db.exec("create function public.zz_new() returns int language sql as $$ select 1 $$;");
ok("a new function is not executable by anon by default", /permission denied/.test(await err(anon("select public.zz_new()")) ?? ""));
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
