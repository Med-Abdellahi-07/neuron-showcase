// QCM حر العدد + Duel بأسئلة ذكاء اصطناعي (حالة private، create_ai_duel لـservice_role فقط)
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


const mkQ = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ statement: `سؤال ${i + 1}`, options: ["a", "b", "c", "d"], correct_index: i % 4, explanation: "لأن", lesson: lessI, ...extra }));
const mkAi = (u, opp, qs, subj = subI) => svc("select public.create_ai_duel($1,$2,$3,$4,$5::jsonb) id", [u, opp, subj, [lessI], JSON.stringify(qs)]);

// ══════════ عدد حر 1..50 ══════════
const setIns = (cnt) => db.query("insert into public.ai_qcm_sets (user_id, cohort_id, subject_id, lesson_ids, question_count, difficulty) values ($1,$2,$3,$4,$5,'medium')", [A, IAA, subI, [lessI], cnt]);
const e1 = await err(setIns(1));
ok("ai_qcm_sets يقبل 1 و7 و50", !e1 && !(await err(setIns(7))) && !(await err(setIns(50))));
ok("ai_qcm_sets يرفض 0 و51 (قيد question_count)", has(await err(setIns(0)), "question_count_check") && has(await err(setIns(51)), "question_count_check"));

// ══════════ تكلفة duel وعلمه ══════════
ok("ai_costs فيه duel→ai_duel", (await one("select flag from public.ai_costs where kind='duel'")).flag === "ai_duel");
ok("ai_spend('duel') يعمل لـIAA ويُرفض لفضاء معطّل", (await q(A, "select public.ai_spend('duel') r"))[0].r.ok === true && (await q(S, "select public.ai_spend('duel') r"))[0].r.reason === "disabled");

// ══════════ create_ai_duel: للخادم فقط ══════════
ok("الطالب لا يستدعي create_ai_duel مباشرة", denied(await err(q(A, "select public.create_ai_duel($1,$2,$3,$4,$5::jsonb)", [A, B, subI, [lessI], JSON.stringify(mkQ(5))]))));
ok("anon لا يستدعيها", denied(await err(anon("select public.create_ai_duel($1,$2,$3,$4,$5::jsonb)", [A, B, subI, [lessI], JSON.stringify(mkQ(5))]))));
ok("أقل من 5 أسئلة مرفوع", has(await err(mkAi(A, B, mkQ(4))), "not_enough_questions"));
ok("أكثر من 15 مرفوض", has(await err(mkAi(A, B, mkQ(16))), "bad_questions"));
ok("سؤال بثلاثة خيارات مرفوض", has(await err(mkAi(A, B, [...mkQ(4), { statement: "x", options: ["a", "b", "c"], correct_index: 0, explanation: "e" }])), "bad_questions"));
ok("خصم من فضاء آخر مرفوض", has(await err(mkAi(A, S, mkQ(5))), "bad_opponent"));
ok("مادة من فضاء آخر مرفوضة", has(await err(mkAi(A, B, mkQ(5), subS)), "bad_subject"));
ok("فضاء بلا duel/ai_duel مرفوض", has(await err(mkAi(S, S, mkQ(5), subS)), "feature_disabled") || has(await err(mkAi(S, S, mkQ(5), subS)), "bad_opponent"));
ok("لم تُنشأ أسئلة private من المحاولات الفاشلة", (await n("select count(*) c from public.questions where status='private'")) === 0);

const d = (await mkAi(A, B, mkQ(6)))[0].id;
ok("Duel أُنشئ بـ6 أسئلة private", (await n("select cardinality(question_ids) c from public.duels where id=$1", [d])) === 6 && (await n("select count(*) c from public.questions where status='private'")) === 6);
ok("duel_exists عند محاولة ثانية مع نفس الزميل", has(await err(mkAi(A, B, mkQ(5))), "duel_exists"));

// ══════════ عزل أسئلة private ══════════
ok("الطالب لا يقرأ أسئلة private", (await q(A, "select count(*)::int c from public.questions where status='private'"))[0].c === 0);
ok("المشرف ومشرف الفضاء لا يرونها", (await q(SAI, "select count(*)::int c from public.questions where status='private'"))[0].c === 0 && (await q(ADM, "select count(*)::int c from public.questions where status='private'"))[0].c === 0);
ok("create_duel العادي لا يلتقطها (لا أسئلة منشورة)", has(await err(q(A, "select public.create_duel($1,$2,'{}',5)", [(await mkP("z", "student", IAA)), subI])), "not_enough_questions"));

// ══════════ اللعب: الأسئلة بلا الإجابة، والنتيجة بعد الاكتمال ══════════
const play = async (u, qs) => { for (const x of qs) await q(u, "select public.duel_answer($1,$2,$3)", [d, x.id, x.pick(x)]); };
const dq = (await q(A, "select public.duel_questions($1) r", [d]))[0].r;
ok("duel_questions يعيد 6 أسئلة بلا correct_index", dq.questions.length === 6 && dq.questions.every((x) => x.correct_index === undefined && x.options.length === 4));
const truth = await db.query("select id, correct_index from public.questions where status='private'");
const ci = new Map(truth.rows.map((r) => [r.id, r.correct_index]));
await play(A, dq.questions.map((x) => ({ id: x.id, pick: (y) => ci.get(y.id) })));
ok("المتحدّي أنهى فصار التحدي open", (await one("select status from public.duels where id=$1", [d])).status === "open");
const dqB = (await q(B, "select public.duel_questions($1) r", [d]))[0].r;
await play(B, dqB.questions.map((x) => ({ id: x.id, pick: (y) => (ci.get(y.id) + 1) % 4 })));
const res = (await q(A, "select public.duel_result($1) r", [d]))[0].r;
ok("انتهى التحدي والفائز المتحدّي", res.status === "completed" && res.winner_id === A);
ok("النتيجة تكشف الإجابة الصحيحة والشرح فقط بعد الاكتمال", res.questions.length === 6 && res.questions.every((x) => Number.isInteger(x.correct_index) && x.explanation === "لأن"));
ok("غير اللاعبين لا يرون النتيجة", has(await err(q(SAI, "select public.duel_result($1)", [d])), "duel_not_found"));

// ══════════ التنظيف ══════════
await db.query("update public.questions set created_at = now() - interval '91 days' where status='private'");
await svc("select public.duel_sweep()");
ok("duel_sweep يحذف أسئلة private بعد 90 يومًا", (await n("select count(*) c from public.questions where status='private'")) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
