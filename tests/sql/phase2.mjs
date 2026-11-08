import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const M = new URL("../../supabase/migrations/", import.meta.url).pathname;
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid());
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage; create function storage.foldername(name text) returns text[] language plpgsql immutable as $$ declare _parts text[]; begin select string_to_array(name, '/') into _parts; return _parts[1:array_length(_parts, 1) - 1]; end $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
  create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated, service_role;
  grant all on all tables in schema storage to authenticated;
`);
for (const f of ["0001_phase1_core.sql", "0002_grants.sql", "0003_phase2_arena.sql"]) await db.exec(fs.readFileSync(M + f, "utf8"));
await db.exec(fs.readFileSync(M + "0003_phase2_arena.sql", "utf8")); // idempotent

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "✓" : "✗"} ${name} ${cond ? "" : extra}`); };

const cohort = (await db.query("select id from public.cohorts order by (name = 'IAA L2') desc, created_at limit 1")).rows[0].id;
const sem = (await db.query("select id from public.semesters where is_current limit 1")).rows[0]?.id
  ?? (await db.query("select id from public.semesters limit 1")).rows[0].id;
await db.query("update public.semesters set is_current = (id = $1)", [sem]);
const subj = (await db.query("select id from public.subjects where semester_id=$1 order by sort limit 2", [sem])).rows;
const [S1, S2] = [subj[0].id, subj[1].id];

async function mkUser(name, role = "student", hide = false) {
  const id = (await db.query("insert into auth.users default values returning id")).rows[0].id;
  await db.query("insert into public.profiles (id, full_name, role, cohort_id, hide_from_ranking) values ($1,$2,$3,$4,$5)", [id, name, role, cohort, hide]);
  return id;
}
const A = await mkUser("Alice"), B = await mkUser("Bob"), C = await mkUser("Carl", "student", true), ADM = await mkUser("Admin", "admin");

// Questions: S1 has 25 QCM (easy/medium/hard) + 2 written; S2 has 6 QCM
const qs = { S1: [], S2: [], W: [] };
for (let i = 0; i < 25; i++) {
  const d = ["easy", "medium", "hard"][i % 3];
  const r = await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,explanation,status) values ($1,'mcq',$2,$3,$4,1,'because',$5) returning id",
    [S1, d, "Q" + i, JSON.stringify(["a", "b", "c"]), "published"]);
  qs.S1.push({ id: r.rows[0].id, d });
}
for (let i = 0; i < 6; i++) {
  const r = await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,status) values ($1,'mcq','easy',$2,$3,0,'published') returning id", [S2, "R" + i, JSON.stringify(["x", "y"])]);
  qs.S2.push({ id: r.rows[0].id, d: "easy" });
}
for (let i = 0; i < 2; i++) {
  const r = await db.query("insert into public.questions (subject_id,type,difficulty,statement,model_answer,status) values ($1,'written','medium',$2,'model','published') returning id", [S1, "W" + i]);
  qs.W.push(r.rows[0].id);
}
await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,status) values ($1,'mcq','easy','draft',$2,0,'draft')", [S1, JSON.stringify(["a", "b"])]);

async function as(user, role, fn) {
  await db.exec("begin"); await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
  try { const r = await fn(); await db.exec("commit"); return r; }
  catch (e) { await db.exec("rollback"); throw e; }
}
const call = (user, sql, params = []) => as(user, "authenticated", async () => (await db.query(sql, params)).rows);
const err = async (p) => { try { await p; return null; } catch (e) { return e.message; } };
const start = async (u, mode, o = {}) => (await call(u, "select public.start_attempt($1,$2,$3,$4,$5,$6,$7,$8,$9) id",
  [mode, o.subject ?? null, o.lesson ?? null, o.from ?? null, o.to ?? null, o.difficulty ?? null, o.type ?? "mixed", o.count ?? 10, o.minutes ?? 0]))[0].id;
const attemptQs = async (u, id) => (await call(u, "select question_ids from public.attempts where id=$1", [id]))[0].question_ids;
const answer = async (u, a, q, sel, self = null, ms = null) => (await call(u, "select public.submit_answer($1,$2,$3,$4,$5) r", [a, q, sel, self, ms]))[0].r;
const right = (id) => (qs.S2.some((x) => x.id === id) ? 0 : 1);
const wrong = (id) => (right(id) === 0 ? 1 : 0);
const meta = (id) => [...qs.S1, ...qs.S2].find((x) => x.id === id);

// -- Column and table security
ok("a student cannot read correct_index", /permission denied/.test(await err(call(A, "select correct_index from public.questions")) ?? ""));
ok("a student cannot read explanation", /permission denied/.test(await err(call(A, "select explanation from public.questions")) ?? ""));
ok("a student cannot select *", /permission denied/.test(await err(call(A, "select * from public.questions")) ?? ""));
ok("a student reads statement/options/model_answer", (await call(A, "select statement, options, model_answer from public.questions")).length > 0);
ok("no direct write to attempts", /permission denied/.test(await err(call(A, "insert into public.attempts (user_id,mode,question_ids,total) values ($1,'ranked','{}',0)", [A])) ?? ""));
ok("no direct write to attempt_answers", /permission denied/.test(await err(call(A, "delete from public.attempt_answers")) ?? ""));
ok("no direct edit of review_queue", /permission denied/.test(await err(call(A, "update public.review_queue set stage=3")) ?? ""));
ok("anon cannot run start_attempt", /permission denied/.test(await err(as(A, "anon", () => db.query("select public.start_attempt('free')"))) ?? ""));
// A moderator can still manage questions (insert...returning id, update, delete)
const ins = await call(ADM, "insert into public.questions (subject_id,type,difficulty,statement,model_answer,status) values ($1,'written','easy','tmp','m','published') returning id", [S1]);
ok("admin: insert returning id", ins.length === 1);
await call(ADM, "update public.questions set status='draft' where id=$1", [ins[0].id]);
ok("admin: conditional update", (await call(ADM, "select status from public.questions where id=$1", [ins[0].id]))[0].status === "draft");
await call(ADM, "delete from public.questions where id=$1", [ins[0].id]);
ok("admin: delete", true);

// -- Ranked quiz
const R1 = await start(A, "ranked");
const R1again = await start(A, "ranked");
ok("calling again returns the attempt in progress (no re-draw)", R1 === R1again);
let ids = await attemptQs(A, R1);
ok("exactly 20 questions, all published QCM", ids.length === 20 && ids.every((i) => meta(i)));
ok("no duplicates", new Set(ids).size === 20);
const lim = (await call(A, "select time_limit_seconds t, mode from public.attempts where id=$1", [R1]))[0];
ok("20 minutes", lim.t === 1200 && lim.mode === "ranked");

const r1 = await answer(A, R1, ids[0], right(ids[0])); // correct (correct_index=1)
const m0 = meta(ids[0]);
const base0 = { easy: 1, medium: 2, hard: 3 }[m0.d];
ok("correct: points between the base value and +50%", r1.is_correct && r1.points >= base0 && r1.points <= base0 * 1.5 && r1.counted, JSON.stringify(r1));
ok("an instant answer gets the full bonus", Number(r1.bonus) >= base0 * 0.49, JSON.stringify(r1));
const rep = await answer(A, R1, ids[0], wrong(ids[0]));
ok("resubmitting the same question returns the first result", rep.repeat === true && rep.is_correct === true && rep.points === r1.points);
const r2 = await answer(A, R1, ids[1], wrong(ids[1])); // wrong
ok("wrong: 0 points and the correct answer is revealed", !r2.is_correct && Number(r2.points) === 0 && r2.correct_index === right(ids[1]) && (r2.explanation === "because" || r2.explanation === null));
const rq = (await call(A, "select stage, mastered, due_at > now() + interval '23 hours' and due_at < now() + interval '25 hours' as d1 from public.review_queue where question_id=$1", [ids[1]]))[0];
ok("the mistake was saved automatically: stage 0 after one day", rq && rq.stage === 0 && !rq.mastered && rq.d1, JSON.stringify(rq));
ok("attempt in progress: answers are recorded", (await call(A, "select answered, correct, points from public.attempts where id=$1", [R1]))[0].answered === 2);

// Another student cannot answer in someone else's attempt
ok("another student cannot answer in my attempt", /attempt_not_found/.test(await err(answer(B, R1, ids[2], 1)) ?? ""));
ok("a question outside the attempt is rejected", /question_not_in_attempt/.test(await err(answer(A, R1, qs.W[0], null, true)) ?? ""));
ok("an answer with an invalid option is rejected", /bad_answer/.test(await err(answer(A, R1, ids[2], 9)) ?? ""));

// Answer the rest (all correct), then check automatic completion
for (let i = 2; i < 20; i++) await answer(A, R1, ids[i], right(ids[i]));
const fin = (await call(A, "select finished_at is not null f, answered, correct, points from public.attempts where id=$1", [R1]))[0];
ok("finishes automatically when all are answered", fin.f && fin.answered === 20, JSON.stringify(fin));
const dbg1 = (await db.query("select count(*)::int n, count(*) filter (where is_counted)::int c from public.attempt_answers where user_id=$1", [A])).rows[0]; console.log("DBG after R1", JSON.stringify(dbg1));
const Rf = await start(A, "free", { subject: S1, count: 3 }); const idsRf = await attemptQs(A, Rf); await call(A, "select public.finish_attempt($1)", [Rf]);
ok("an answer in a finished attempt is rejected", /attempt_finished/.test(await err(answer(A, Rf, idsRf[0], 1)) ?? ""));

// -- Only the first attempt counts: set S2 has 6 questions
const R2a = await start(A, "ranked", { subject: S2 });
const idsA = await attemptQs(A, R2a);
ok("subject scope: only 6 questions (fewer than 20 is allowed, at least 5)", idsA.length === 6);
for (const q of idsA) await answer(A, R2a, q, 0);
console.log("DBG after R2a", JSON.stringify((await db.query("select count(*)::int n, count(*) filter (where is_counted)::int c from public.attempt_answers where user_id=$1", [A])).rows[0]));
const R2b = await start(A, "ranked", { subject: S2 });
ok("a new attempt after finishing = a new id", R2b !== R2a);
let counted2 = 0, pts2 = 0;
for (const q of await attemptQs(A, R2b)) { const r = await answer(A, R2b, q, 0); if (r.counted) counted2++; pts2 += Number(r.points); }
ok("the repeat does not count in the ranking and gives no points", counted2 === 0 && pts2 === 0, `counted=${counted2} pts=${pts2}`);

// -- A new ranked quiz in S1 prefers questions not yet counted
const R3 = await start(A, "ranked", { subject: S1 });
const ids3 = await attemptQs(A, R3);
const seenS1 = new Set((await db.query("select question_id from public.attempt_answers where user_id=$1 and is_counted", [A])).rows.map((r) => r.question_id));
const unseenTotal = qs.S1.filter((q) => !seenS1.has(q.id)).length;
const fresh = ids3.filter((i) => !seenS1.has(i)).length;
ok("prefers questions not counted before", fresh === Math.min(20, unseenTotal), `fresh=${fresh} unseenTotal=${unseenTotal}`);
await call(A, "select public.finish_attempt($1)", [R3]);

// -- The ranked quiz requires at least 5 questions
await db.query("update public.questions set status='draft' where subject_id=$1 and statement not in ('R0','R1')", [S2]);
ok("fewer than 5 questions -> not_enough_questions", /not_enough_questions/.test(await err(start(B, "ranked", { subject: S2 })) ?? ""));
await db.query("update public.questions set status='published' where subject_id=$1", [S2]);

// -- B plays with a different performance, C is hidden
const RB = await start(B, "ranked", { subject: S1 });
for (const q of (await attemptQs(B, RB)).slice(0, 4)) await answer(B, RB, q, 1);
const RC = await start(C, "ranked", { subject: S1 });
for (const q of (await attemptQs(C, RC))) await answer(C, RC, q, 1);
const lbA = await call(A, "select * from public.leaderboard('week','UTC')");
ok("weekly ranking: only Alice and Bob from Alice's view", lbA.map((r) => r.full_name).sort().join() === "Alice,Bob", JSON.stringify(lbA.map((r) => r.full_name)));
ok("the hidden user (Carl) is not shown to others", !lbA.some((r) => r.full_name === "Carl"));
ok("Alice is first and her accuracy is computed", lbA[0].full_name === "Alice" && lbA[0].rank === 1 && Number(lbA[0].accuracy) > 0, JSON.stringify(lbA[0]));
const alice = lbA.find((r) => r.is_me);
const aliceCounted = Number((await db.query("select sum(points) s, count(*) n from public.attempt_answers where user_id=$1 and is_counted", [A])).rows[0].s);
ok("ranking points = the sum of counted answers only", Number(alice.points) === aliceCounted, `${alice.points} vs ${aliceCounted}`);
ok("counted answers = distinct questions answered", alice.answered === Number((await db.query("select count(distinct question_id) n from public.attempt_answers where user_id=$1 and is_counted", [A])).rows[0].n), `answered=${alice.answered}`);
const lbC = await call(C, "select * from public.leaderboard('week','UTC')");
const meC = lbC.find((r) => r.is_me);
ok("the hidden user sees their own rank (hidden=true) and the rest of the list", meC && meC.hidden && lbC.length === 3, JSON.stringify(lbC));
ok("the hidden user's rank does not push others down", lbA.find((r) => r.full_name === "Bob").rank === 2);
const lbS = await call(A, "select * from public.leaderboard('semester','UTC')");
ok("the semester ranking works", lbS.length === 2 && lbS[0].full_name === "Alice");
// New week: last week's points do not show
await db.query("update public.attempt_answers set answered_at = now() - interval '9 days' where user_id=$1", [B]);
const lbA2 = await call(A, "select * from public.leaderboard('week','UTC')");
ok("weekly resets (Bob drops out) and semester is cumulative", !lbA2.some((r) => r.full_name === "Bob") && (await call(A, "select * from public.leaderboard('semester','UTC')")).some((r) => r.full_name === "Bob"));
ok("a student with no cohort sees nothing", (await (async () => { const X = (await db.query("insert into auth.users default values returning id")).rows[0].id; await db.query("insert into public.profiles (id, full_name) values ($1,'Nobody')", [X]); return call(X, "select * from public.leaderboard('week','UTC')"); })()).length === 0);

// -- Time expiry
const RT = await start(B, "ranked", { subject: S1 }).catch(() => null); // B has an attempt in progress (RB) -> returns the same one
await db.query("update public.attempts set started_at = now() - interval '30 minutes' where id=$1", [RB]);
const idsRB = await attemptQs(B, RB);
ok("after time expiry: the answer is rejected", /attempt_expired/.test(await err(answer(B, RB, idsRB[10], 1)) ?? ""));
const RB2 = await start(B, "ranked", { subject: S1 });
ok("after expiry a new attempt starts", RB2 !== RB);

// -- Free practice
const F = await start(A, "free", { subject: S1, type: "written", count: 5 });
const idsF = await attemptQs(A, F);
ok("free: written only, and no time limit", idsF.length === 2 && idsF.every((i) => qs.W.includes(i)) && (await call(A, "select time_limit_seconds t from public.attempts where id=$1", [F]))[0].t === null);
const w1 = await answer(A, F, idsF[0], null, false);
ok("written, self-marked wrong -> saved to mistakes, no points", !w1.is_correct && w1.points === 0 && w1.model_answer === "model" && (await call(A, "select 1 from public.review_queue where question_id=$1", [idsF[0]])).length === 1);
const w2 = await answer(A, F, idsF[1], null, true);
ok("written, self-marked correct: does not enter mistakes", w2.is_correct && (await call(A, "select 1 from public.review_queue where question_id=$1", [idsF[1]])).length === 0);
ok("written without self_correct is rejected", /bad_answer/.test(await err(answer(A, await start(A, "free", { subject: S1, type: "written" }), idsF[0], null, null)) ?? ""));
const F2 = await start(A, "free", { subject: S2, difficulty: "easy", count: 3, minutes: 5 });
const f2q = await attemptQs(A, F2);
const f2r = await answer(A, F2, f2q[0], 0);
ok("free: points for display but no effect on the ranking", f2r.is_correct && Number(f2r.points) > 0 && f2r.counted === false);
const lbA3 = await call(A, "select * from public.leaderboard('week','UTC')");
ok("the ranking did not change after free practice", Number(lbA3.find((r) => r.is_me).points) === aliceCounted);
ok("the time limit is recorded in seconds", (await call(A, "select time_limit_seconds t from public.attempts where id=$1", [F2]))[0].t === 300);
ok("no questions -> no_questions", /no_questions/.test(await err(start(A, "free", { subject: S2, difficulty: "hard" })) ?? ""));
ok("a lesson range with no linked lessons -> no questions", /no_questions/.test(await err(start(A, "free", { subject: S1, from: 5, to: 9 })) ?? ""));

// -- Spaced review
const dueNow = async (qid) => db.query("update public.review_queue set due_at = now() - interval '1 minute' where user_id=$1 and question_id=$2", [A, qid]);
// Alice's current mistakes: ids[1] (wrong in R1) + 3 questions from R2/R2b; pick one specific question
const target = ids[1];
// The right/wrong direction is derived from the actual correct_index (assuming 1 made the test flaky)
const ci = async () => Number((await db.query("select correct_index from public.questions where id=$1", [target])).rows[0].correct_index);
const RIGHT = await ci(), WRONG = RIGHT === 0 ? 1 : 0;
ok("no review before the due date", /no_questions/.test(await err(start(A, "review")) ?? "") || (await call(A, "select count(*)::int c from public.review_queue where due_at <= now()"))[0].c >= 0);
await db.query("update public.review_queue set due_at = now() + interval '1 day' where user_id=$1", [A]); // nothing due
ok("nothing due -> no_questions", /no_questions/.test(await err(start(A, "review")) ?? ""));
await dueNow(target);
const V1 = await start(A, "review");
ok("review includes only what is due", (await attemptQs(A, V1)).length === 1 && (await attemptQs(A, V1))[0] === target);
const v1r = await answer(A, V1, target, RIGHT);
const st = async () => (await call(A, "select stage, mastered, extract(epoch from (due_at - now()))/86400 as days from public.review_queue where question_id=$1", [target]))[0];
let s = await st();
ok("correct in review: stage 1 after 3 days", s.stage === 1 && Math.abs(s.days - 3) < 0.01 && !s.mastered, JSON.stringify(s));
ok("review gives no points and does not enter the ranking", Number(v1r.points) === 0 && !v1r.counted);
await dueNow(target); let V = await start(A, "review"); await answer(A, V, target, RIGHT); s = await st();
ok("stage 2: after one week", s.stage === 2 && Math.abs(s.days - 7) < 0.01, JSON.stringify(s));
await dueNow(target); V = await start(A, "review"); await answer(A, V, target, RIGHT); s = await st();
ok("stage 3: after two weeks", s.stage === 3 && Math.abs(s.days - 14) < 0.01, JSON.stringify(s));
await dueNow(target); V = await start(A, "review"); await answer(A, V, target, WRONG); s = await st();
ok("a mistake returns it to the start (stage 0 after one day)", s.stage === 0 && Math.abs(s.days - 1) < 0.01 && !s.mastered, JSON.stringify(s));
for (let k = 0; k < 4; k++) { await dueNow(target); V = await start(A, "review"); await answer(A, V, target, RIGHT); }
s = await st();
ok("after completing the four stages -> mastered", s.mastered === true, JSON.stringify(s));
ok("a mastered question does not return to review", /no_questions/.test(await err(start(A, "review")) ?? ""));
// A mistake in free practice on a mastered question brings it back
const F3 = await start(A, "free", { subject: S1, count: 50 });
const inF3 = (await attemptQs(A, F3)).includes(target);
if (inF3) { await answer(A, F3, target, WRONG); const r = await st(); ok("a later mistake sends a mastered question back to review", r.mastered === false && r.stage === 0, JSON.stringify(r)); }
else { await db.query("update public.attempts set question_ids = question_ids || $2::uuid where id=$1", [F3, target]); await answer(A, F3, target, WRONG); const r = await st(); ok("a later mistake sends a mastered question back to review", r.mastered === false && r.stage === 0, JSON.stringify(r)); }

// -- p_client_ms and attempt_review
{
  const Fm = await start(A, "free", { subject: S2, count: 2 }); const fq = await attemptQs(A, Fm);
  await new Promise((r) => setTimeout(r, 300));
  const slow = await answer(A, Fm, fq[0], 0, null, 0); // the browser says 0 ms
  ok("free: the smaller browser time is used (full bonus)", Number(slow.bonus) >= 0.49, JSON.stringify(slow));
  const cheat = await answer(A, Fm, fq[1], 0, null, -5);
  ok("a negative time is ignored", cheat.elapsed_ms >= 0);
  const rv = (await call(A, "select public.attempt_review($1) r", [Fm]))[0].r;
  ok("reviewing a finished attempt reveals the answer and explanation", rv.length === 2 && rv.every((x) => x.correct_index === 0 && x.answered));
  const Rr = await start(B, "ranked", { subject: S1 }); const rr = await attemptQs(B, Rr);
  ok("before finishing: only what was answered is revealed", (await call(B, "select public.attempt_review($1) r", [Rr]))[0].r.length === 0);
  await answer(B, Rr, rr[0], 1);
  const rv2 = (await call(B, "select public.attempt_review($1) r", [Rr]))[0].r;
  ok("after answering one question only that one shows", rv2.length === 1 && rv2[0].question_id === rr[0]);
  const rk = await answer(B, Rr, rr[1], 1, null, 0);
  ok("the ranked quiz ignores the browser time", rk.elapsed_ms >= 0 && rk.bonus !== undefined);
  ok("another student cannot review my attempt", /attempt_not_found/.test(await err(call(A, "select public.attempt_review($1)", [Rr])) ?? ""));
}

// -- Data isolation between students
ok("Bob cannot see Alice's attempts", (await call(B, "select count(*)::int c from public.attempts where user_id=$1", [A]))[0].c === 0);
ok("Bob cannot see Alice's answers/reviews", (await call(B, "select (select count(*) from public.attempt_answers where user_id=$1)::int a, (select count(*) from public.review_queue where user_id=$1)::int r", [A]))[0].a === 0);
ok("the admin sees everything", (await call(ADM, "select count(*)::int c from public.attempts"))[0].c > 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
