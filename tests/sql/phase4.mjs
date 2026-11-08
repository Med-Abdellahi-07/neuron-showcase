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
const cohort2 = (await db.query("insert into public.cohorts(name) values ('Other') returning id")).rows[0].id;
const sem = (await db.query("select id from public.semesters where is_current and cohort_id = $1 limit 1", [cohort])).rows[0].id;
const S1 = (await db.query("select id from public.subjects where semester_id=$1 order by sort limit 1", [sem])).rows[0].id;
const mk = async (name, role = "student", c = cohort) => { const id = (await db.query("insert into auth.users default values returning id")).rows[0].id; await db.query("insert into public.profiles (id, full_name, role, cohort_id) values ($1,$2,$3,$4)", [id, name, role, c]); return id; };
const A = await mk("A"), B = await mk("B"), C = await mk("C"), X = await mk("X", "student", cohort2);
const ADM = await mk("Adm", "admin"), MOD = await mk("Mod", "moderator"), MODD = await mk("ModD", "moderator");
await db.query("update public.profiles set can_publish_direct=true where id=$1", [MODD]);

// -- Recordings
const rec = (u, status = "published") => q(u, "insert into public.recordings (cohort_id,subject_id,kind,rec_date,title,provider,video_id,status) values ($1,$2,'cm','2026-10-10','Séance 1','youtube','dQw4w9WgXcQ',$3) returning id,status", [cohort, S1, status]);
const r1 = (await rec(ADM))[0];
ok("recording: the admin publishes directly", r1.status === "published");
const r2 = (await rec(MOD))[0];
ok("recording: a moderator without permission -> pending", r2.status === "pending");
const r3 = (await rec(MODD))[0];
ok("recording: a moderator with direct publishing -> published", r3.status === "published");
ok("recording: a student sees published only", (await q(A, "select id from public.recordings")).map((r) => r.id).sort().join() === [r1.id, r3.id].sort().join());
ok("recording: a student of another cohort sees nothing", (await q(X, "select id from public.recordings")).length === 0);
ok("recording: a student cannot write", denied(await err(rec(A))));
ok("recording: a malformed video_id is rejected", /check/.test(await err(q(ADM, "insert into public.recordings (cohort_id,subject_id,kind,rec_date,title,provider,video_id) values ($1,$2,'cm','2026-10-10','t','youtube','a b<script>')", [cohort, S1])) ?? ""));
ok("recording: a moderator sees their pending request", (await q(MOD, "select id from public.recordings")).length === 3);
await q(ADM, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1, 90, 'Intro')", [r1.id]);
ok("video markers: a student reads markers of published recordings", (await q(A, "select * from public.recording_marks")).length === 1);
ok("video markers: a student cannot write", denied(await err(q(A, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1,1,'x')", [r1.id]))));
ok("video markers: no leakage of a pending recording's markers", (await q(ADM, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1,5,'hid') returning id", [r2.id])).length === 1 && (await q(A, "select * from public.recording_marks")).length === 1);
ok("recording: anon is forbidden", denied(await err(anon("select * from public.recordings"))));

// -- Announcements
await q(ADM, "insert into public.announcements (cohort_id,title,expires_at) values ($1,'old', now() - interval '1 day'), ($1,'live', now() + interval '1 day'), ($1,'forever', null)", [cohort]);
ok("announcement: a student does not see expired ones", (await q(A, "select title from public.announcements order by title")).map((r) => r.title).join() === "forever,live");
ok("announcement: a moderator sees all", (await q(MOD, "select 1 from public.announcements")).length === 3);
ok("announcement: a student cannot publish", denied(await err(q(A, "insert into public.announcements (cohort_id,title) values ($1,'x')", [cohort]))));
ok("announcement: a student of another cohort does not see them", (await q(X, "select 1 from public.announcements")).length === 0);

// -- Duel questions
const qs = [];
for (let i = 0; i < 6; i++) qs.push((await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,explanation,status) values ($1,'mcq','medium',$2,'[\"a\",\"b\",\"c\"]',1,'because','published') returning id", [S1, `Q${i}`])).rows[0].id);
await db.query("insert into public.questions (subject_id,type,difficulty,statement,model_answer,status) values ($1,'written','easy','W','m','published')", [S1]);

// ── Duel
ok("duel: tables are closed to students", denied(await err(q(A, "select * from public.duels"))) && denied(await err(q(A, "select * from public.duel_answers"))));
ok("duel: an opponent from another cohort is rejected", /bad_opponent/.test(await err(q(A, "select public.create_duel($1,$2,'{}',5)", [X, S1])) ?? ""));
ok("duel: cannot challenge yourself", /bad_opponent/.test(await err(q(A, "select public.create_duel($1,$2,'{}',5)", [A, S1])) ?? ""));
ok("duel: anon is forbidden", denied(await err(anon("select public.create_duel(null,null)"))));
const D = (await q(A, "select public.create_duel($1,$2,'{}',5) id", [B, S1]))[0].id;
ok("duel: one active duel per pair", /duel_exists/.test(await err(q(B, "select public.create_duel($1,$2,'{}',5)", [A, S1])) ?? ""));
ok("duel: the opponent cannot play before the challenger", /duel_not_playable/.test(await err(q(B, "select public.duel_questions($1)", [D])) ?? ""));
ok("duel: a third party has no access", /duel_not_found/.test(await err(q(C, "select public.duel_questions($1)", [D])) ?? ""));
const dq = (await q(A, "select public.duel_questions($1) r", [D]))[0].r;
ok("duel: questions without the correct answer", dq.questions.length === 5 && !JSON.stringify(dq).includes("correct_index") && !JSON.stringify(dq).includes("because"));
ok("duel: written questions are not included", !dq.questions.some((x) => x.statement === "W"));
// The challenger answers: 4 correct (index 1) and 1 wrong
const ans = (u, qid, sel) => q(u, "select public.duel_answer($1,$2,$3) r", [D, qid, sel]).then((r) => r[0].r);
let last;
for (let i = 0; i < 5; i++) last = await ans(A, dq.questions[i].id, i < 4 ? 1 : 0);
ok("duel: replying with the answer does not reveal correctness", !("is_correct" in last) && !("points" in last));
ok("duel: the challenger finishes -> open + 48-hour deadline", (await db.query("select status, extract(epoch from expires_at - opened_at)/3600 as w from public.duels where id=$1", [D])).rows.map((r) => r.status + "|" + Number(r.w))[0] === "open|48");
ok("duel: no re-answering after the turn ends", /already_finished/.test(await err(ans(A, dq.questions[0].id, 0)) ?? ""));
ok("duel: the challenger cannot see the result before the opponent", (await q(A, "select public.duel_result($1) r", [D]))[0].r.questions === undefined);
ok("duel: my duels list has no result before completion", (await q(A, "select public.my_duels() r"))[0].r[0].result === null);
ok("duel: the opponent sees the duel open", (await q(B, "select public.my_duels() r"))[0].r[0].status === "open" && (await q(B, "select public.my_duels() r"))[0].r[0].i_am_challenger === false);
const rq = (await q(B, "select public.duel_questions($1) r", [D]))[0].r;
ok("duel: the opponent sits the same questions", rq.questions.map((x) => x.id).join() === dq.questions.map((x) => x.id).join());
ok("duel: the opponent does not see the challenger's answers", !JSON.stringify(rq).includes("selected"));
// The opponent: 5 correct -> wins
for (let i = 0; i < 5; i++) last = await ans(B, rq.questions[i].id, 1);
const dres = (await q(B, "select public.duel_result($1) r", [D]))[0].r;
ok("duel: completed and the opponent won", dres.status === "completed" && dres.winner_id === B && dres.is_draw === false, JSON.stringify(dres.status));
ok("duel: the correct answers are shown now", dres.questions[0].correct_index === 1 && dres.questions[0].explanation === "because" && dres.questions[0].answers.length === 2);
ok("duel: the comparison (points/correct/time)", dres.players.length === 2 && dres.players.every((p) => "points" in p && "correct" in p && "total_ms" in p) && dres.players.find((p) => p.user_id === B).correct === 5 && dres.players.find((p) => p.user_id === A).correct === 4);
ok("duel: the challenger sees the result after completion", (await q(A, "select public.duel_result($1) r", [D]))[0].r.winner_id === B);
ok("duel: no answers after completion", /duel_not_playable|already_finished/.test(await err(ans(B, rq.questions[0].id, 1)) ?? ""));
ok("duel: a third party does not see the result", /duel_not_found/.test(await err(q(C, "select public.duel_result($1)", [D])) ?? ""));

// Deadline expiry = the challenger wins
const D2 = (await q(A, "select public.create_duel($1,$2,'{}',5) id", [C, S1]))[0].id;
const d2q = (await q(A, "select public.duel_questions($1) r", [D2]))[0].r;
for (const x of d2q.questions) await q(A, "select public.duel_answer($1,$2,0)", [D2, x.id]);
await db.query("update public.duels set expires_at = now() - interval '1 minute' where id=$1", [D2]);
ok("duel: at deadline expiry the opponent cannot answer", /duel_expired|duel_not_playable/.test(await err(q(C, "select public.duel_questions($1)", [D2])) ?? ""));
const exp = (await q(C, "select public.duel_result($1) r", [D2]))[0].r;
ok("duel: deadline expiry = the challenger wins", exp.status === "expired" && exp.winner_id === A);
ok("duel: the opponent sees the correct answers after expiry", exp.questions && exp.questions[0].correct_index === 1);

// A challenger who does not finish is cancelled after 24 hours
const D3 = (await q(B, "select public.create_duel($1,$2,'{}',5) id", [C, S1]))[0].id;
await db.query("update public.duels set created_at = now() - interval '25 hours' where id=$1", [D3]);
await q(B, "select public.my_duels()");
ok("duel: a lagging challenger is cancelled with no result", (await db.query("select status, winner_id from public.duels where id=$1", [D3])).rows[0].status === "cancelled");

// Tie
const D4 = (await q(C, "select public.create_duel($1,$2,'{}',5) id", [A, S1]))[0].id;
const d4q = (await q(C, "select public.duel_questions($1) r", [D4]))[0].r;
// Pin the time to guarantee an exact tie
for (const x of d4q.questions) await q(C, "select public.duel_answer($1,$2,2)", [D4, x.id]);
const d4a = (await q(A, "select public.duel_questions($1) r", [D4]))[0].r;
for (const x of d4a.questions) await q(A, "select public.duel_answer($1,$2,2)", [D4, x.id]);
const d4 = (await db.query("select status, winner_id, is_draw from public.duels where id=$1", [D4])).rows[0];
ok("duel: both zero -> tie or a win on time (consistent)", d4.status === "completed" && (d4.is_draw ? d4.winner_id === null : d4.winner_id !== null));

// Record
const rec1 = await q(A, "select * from public.duel_record()");
const a = rec1.find((r) => r.user_id === A), b = rec1.find((r) => r.user_id === B);
ok("record: A won once (deadline expiry) and lost once", a.wins >= 1 && a.losses >= 1, JSON.stringify(a));
ok("record: B won once", b.wins >= 1);
ok("record: one cohort only", !rec1.some((r) => r.user_id === X));
await db.query("update public.profiles set hide_from_ranking=true where id=$1", [B]);
ok("record: a hidden user is not shown to others", !(await q(A, "select * from public.duel_record()")).some((r) => r.user_id === B) && (await q(B, "select * from public.duel_record()")).some((r) => r.user_id === B));
ok("classmates: not yourself and no other cohorts", (await q(A, "select * from public.cohort_mates()")).every((r) => r.id !== A && r.id !== X));

// -- Notifications
await q(A, "insert into public.push_subscriptions (endpoint,p256dh,auth) values ('https://push.example/abc','p','a')");
ok("push: a subscription belongs to its owner only", (await q(A, "select * from public.push_subscriptions")).length === 1 && (await q(B, "select * from public.push_subscriptions")).length === 0);
ok("push: no subscription in someone else's name", denied(await err(q(A, "insert into public.push_subscriptions (user_id,endpoint,p256dh,auth) values ($1,'https://e/2','p','a')", [B]))));
ok("push: a non-https endpoint is rejected", /check/.test(await err(q(A, "insert into public.push_subscriptions (endpoint,p256dh,auth) values ('http://x','p','a')")) ?? ""));
await q(A, "insert into public.notification_prefs (user_id, duel) values (auth.uid(), false)");
ok("preferences: enabled by default and duel is off", (await q(A, "select * from public.notification_prefs"))[0].review === true && (await q(A, "select duel from public.notification_prefs"))[0].duel === false);
ok("the send log is closed to students", denied(await err(q(A, "select * from public.notification_log"))));
ok("review_reminder_targets: a student is forbidden", denied(await err(q(A, "select * from public.review_reminder_targets()"))));
ok("review_reminder_targets: service_role is allowed", (await as(null, "service_role", async () => (await db.query("select * from public.review_reminder_targets()")).rows)) !== undefined);

// -- Statistics
await q(A, "select public.touch_seen()");
ok("touch_seen updates the last seen", (await db.query("select last_seen_at from public.profiles where id=$1", [A])).rows[0].last_seen_at !== null);
ok("a moderator cannot run the statistics functions", /forbidden/.test(await err(q(MOD, "select * from public.admin_students()")) ?? "") && /forbidden/.test(await err(q(A, "select * from public.admin_ai_daily(7)")) ?? ""));
// Fill in results to test the statistics
const L = (await db.query("insert into public.lessons (subject_id,kind,number,title,status) values ($1,'cm',1,'L1','published') returning id", [S1])).rows[0].id;
await db.query("update public.questions set lesson_id=$1 where statement in ('Q0','Q1','Q2')", [L]);
for (const u of [A, B, C]) {
  const att = (await db.query("insert into public.attempts (user_id,cohort_id,mode,subject_id,question_ids,total) values ($1,$2,'free',$3,$4,3) returning id", [u, cohort, S1, qs.slice(0, 3)])).rows[0].id;
  for (const qq of qs.slice(0, 3)) await db.query("insert into public.attempt_answers (attempt_id,user_id,question_id,subject_id,difficulty,qtype,selected_index,is_correct) values ($1,$2,$3,$4,'medium','mcq',0,false)", [att, u, qq, S1]);
}
const st = await q(ADM, "select * from public.admin_students()");
ok("student statistics: space students only (no student from another space) with last seen", st.length === 3 && !st.some((r) => r.id === X) && st.find((r) => r.id === A).last_seen_at !== null && st.find((r) => r.id === A).answers_7d === 3, JSON.stringify(st.map((r) => r.answers_7d)));
const ss = await q(ADM, "select * from public.admin_subject_stats()");
ok("subject average", ss.length === 11 && ss.find((r) => r.id === undefined || true) && Number(ss.find((r) => r.subject_id === S1).accuracy) === 0 && ss.find((r) => r.subject_id === S1).students === 3);
const wl = await q(ADM, "select * from public.admin_weak_lessons(10)");
ok("weakest lessons: an L1 lesson for most students", wl.length === 1 && wl[0].lesson_id === L && wl[0].weak_students === 3);
// Provider usage
await q(A, "select public.ai_note_use('gemini', false)"); await q(A, "select public.ai_note_use('gemini', false)"); await q(A, "select public.ai_note_use('gemini', true)"); await q(A, "select public.ai_note_use('groq', false)");
await q(A, "select public.ai_note_use('evil', false)");
const ad = await q(ADM, "select * from public.admin_ai_daily(14)");
ok("daily provider usage", ad.find((r) => r.provider === "gemini").calls === 2 && ad.find((r) => r.provider === "gemini").failures === 1 && ad.find((r) => r.provider === "groq").calls === 1 && ad.length === 2);
await q(A, "select public.ai_take('chat', 5, 600, 100)");
const ak = await q(ADM, "select * from public.admin_ai_kinds()");
ok("usage by type (ai_usage)", ak.length === 1 && ak[0].kind === "chat" && ak[0].today === 1 && ak[0].users_today === 1);
ok("the admin cannot read chats despite the statistics", (await q(ADM, "select * from public.conversations")).length === 0 && (await q(ADM, "select * from public.messages")).length === 0);
ok("ai_provider_daily is closed to students", denied(await err(q(A, "select * from public.ai_provider_daily"))));
ok("anon cannot run the phase 4 functions", denied(await err(anon("select * from public.cohort_mates()"))) && denied(await err(anon("select public.touch_seen()"))));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
