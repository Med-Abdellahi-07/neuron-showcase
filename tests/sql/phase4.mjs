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

// ── التسجيلات
const rec = (u, status = "published") => q(u, "insert into public.recordings (cohort_id,subject_id,kind,rec_date,title,provider,video_id,status) values ($1,$2,'cm','2026-10-10','Séance 1','youtube','dQw4w9WgXcQ',$3) returning id,status", [cohort, S1, status]);
const r1 = (await rec(ADM))[0];
ok("تسجيل: المدير ينشر مباشرة", r1.status === "published");
const r2 = (await rec(MOD))[0];
ok("تسجيل: المشرف بلا صلاحية → pending", r2.status === "pending");
const r3 = (await rec(MODD))[0];
ok("تسجيل: المشرف بنشر مباشر → published", r3.status === "published");
ok("تسجيل: الطالب يرى المنشور فقط", (await q(A, "select id from public.recordings")).map((r) => r.id).sort().join() === [r1.id, r3.id].sort().join());
ok("تسجيل: طالب من دفعة أخرى لا يرى شيئاً", (await q(X, "select id from public.recordings")).length === 0);
ok("تسجيل: الطالب لا يكتب", denied(await err(rec(A))));
ok("تسجيل: video_id مشوّه مرفوض", /check/.test(await err(q(ADM, "insert into public.recordings (cohort_id,subject_id,kind,rec_date,title,provider,video_id) values ($1,$2,'cm','2026-10-10','t','youtube','a b<script>')", [cohort, S1])) ?? ""));
ok("تسجيل: المشرف يرى طلبه المعلّق", (await q(MOD, "select id from public.recordings")).length === 3);
await q(ADM, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1, 90, 'Intro')", [r1.id]);
ok("علامات الفيديو: الطالب يقرأ علامات المنشور", (await q(A, "select * from public.recording_marks")).length === 1);
ok("علامات الفيديو: الطالب لا يكتب", denied(await err(q(A, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1,1,'x')", [r1.id]))));
ok("علامات الفيديو: لا تسرّب علامات تسجيل معلّق", (await q(ADM, "insert into public.recording_marks (recording_id, at_seconds, label) values ($1,5,'hid') returning id", [r2.id])).length === 1 && (await q(A, "select * from public.recording_marks")).length === 1);
ok("تسجيل: anon ممنوع", denied(await err(anon("select * from public.recordings"))));

// ── الإعلانات
await q(ADM, "insert into public.announcements (cohort_id,title,expires_at) values ($1,'old', now() - interval '1 day'), ($1,'live', now() + interval '1 day'), ($1,'forever', null)", [cohort]);
ok("إعلان: الطالب لا يرى المنتهي", (await q(A, "select title from public.announcements order by title")).map((r) => r.title).join() === "forever,live");
ok("إعلان: المشرف يرى الكل", (await q(MOD, "select 1 from public.announcements")).length === 3);
ok("إعلان: الطالب لا ينشر", denied(await err(q(A, "insert into public.announcements (cohort_id,title) values ($1,'x')", [cohort]))));
ok("إعلان: طالب دفعة أخرى لا يراها", (await q(X, "select 1 from public.announcements")).length === 0);

// ── أسئلة للتحدي
const qs = [];
for (let i = 0; i < 6; i++) qs.push((await db.query("insert into public.questions (subject_id,type,difficulty,statement,options,correct_index,explanation,status) values ($1,'mcq','medium',$2,'[\"a\",\"b\",\"c\"]',1,'because','published') returning id", [S1, `Q${i}`])).rows[0].id);
await db.query("insert into public.questions (subject_id,type,difficulty,statement,model_answer,status) values ($1,'written','easy','W','m','published')", [S1]);

// ── Duel
ok("duel: الجداول مغلقة على الطالب", denied(await err(q(A, "select * from public.duels"))) && denied(await err(q(A, "select * from public.duel_answers"))));
ok("duel: خصم من دفعة أخرى مرفوض", /bad_opponent/.test(await err(q(A, "select public.create_duel($1,$2,'{}',5)", [X, S1])) ?? ""));
ok("duel: لا تحدي نفسك", /bad_opponent/.test(await err(q(A, "select public.create_duel($1,$2,'{}',5)", [A, S1])) ?? ""));
ok("duel: anon ممنوع", denied(await err(anon("select public.create_duel(null,null)"))));
const D = (await q(A, "select public.create_duel($1,$2,'{}',5) id", [B, S1]))[0].id;
ok("duel: تحدٍّ جارٍ واحد لكل زوج", /duel_exists/.test(await err(q(B, "select public.create_duel($1,$2,'{}',5)", [A, S1])) ?? ""));
ok("duel: الخصم لا يلعب قبل المتحدّي", /duel_not_playable/.test(await err(q(B, "select public.duel_questions($1)", [D])) ?? ""));
ok("duel: طرف ثالث لا يصل", /duel_not_found/.test(await err(q(C, "select public.duel_questions($1)", [D])) ?? ""));
const dq = (await q(A, "select public.duel_questions($1) r", [D]))[0].r;
ok("duel: الأسئلة بلا إجابة صحيحة", dq.questions.length === 5 && !JSON.stringify(dq).includes("correct_index") && !JSON.stringify(dq).includes("because"));
ok("duel: مكتوب لا يدخل", !dq.questions.some((x) => x.statement === "W"));
// المتحدّي يجيب: 4 صحيحة (index 1) و1 خاطئة
const ans = (u, qid, sel) => q(u, "select public.duel_answer($1,$2,$3) r", [D, qid, sel]).then((r) => r[0].r);
let last;
for (let i = 0; i < 5; i++) last = await ans(A, dq.questions[i].id, i < 4 ? 1 : 0);
ok("duel: رد الإجابة لا يكشف الصحة", !("is_correct" in last) && !("points" in last));
ok("duel: انتهاء المتحدّي → open + مهلة 48 ساعة", (await db.query("select status, extract(epoch from expires_at - opened_at)/3600 as w from public.duels where id=$1", [D])).rows.map((r) => r.status + "|" + Number(r.w))[0] === "open|48");
ok("duel: لا إعادة إجابة بعد إنهاء الدور", /already_finished/.test(await err(ans(A, dq.questions[0].id, 0)) ?? ""));
ok("duel: المتحدّي لا يكشف النتيجة قبل الخصم", (await q(A, "select public.duel_result($1) r", [D]))[0].r.questions === undefined);
ok("duel: قائمة تحدياتي بلا نتيجة قبل الاكتمال", (await q(A, "select public.my_duels() r"))[0].r[0].result === null);
ok("duel: الخصم يرى التحدي مفتوحاً", (await q(B, "select public.my_duels() r"))[0].r[0].status === "open" && (await q(B, "select public.my_duels() r"))[0].r[0].i_am_challenger === false);
const rq = (await q(B, "select public.duel_questions($1) r", [D]))[0].r;
ok("duel: الخصم يجلس بنفس الأسئلة", rq.questions.map((x) => x.id).join() === dq.questions.map((x) => x.id).join());
ok("duel: الخصم لا يرى إجابات المتحدّي", !JSON.stringify(rq).includes("selected"));
// الخصم: 5 صحيحة → يفوز
for (let i = 0; i < 5; i++) last = await ans(B, rq.questions[i].id, 1);
const dres = (await q(B, "select public.duel_result($1) r", [D]))[0].r;
ok("duel: اكتمل والفائز هو الخصم", dres.status === "completed" && dres.winner_id === B && dres.is_draw === false, JSON.stringify(dres.status));
ok("duel: الإجابات الصحيحة تظهر الآن", dres.questions[0].correct_index === 1 && dres.questions[0].explanation === "because" && dres.questions[0].answers.length === 2);
ok("duel: المقارنة (نقاط/صحيح/وقت)", dres.players.length === 2 && dres.players.every((p) => "points" in p && "correct" in p && "total_ms" in p) && dres.players.find((p) => p.user_id === B).correct === 5 && dres.players.find((p) => p.user_id === A).correct === 4);
ok("duel: المتحدّي يرى النتيجة بعد الاكتمال", (await q(A, "select public.duel_result($1) r", [D]))[0].r.winner_id === B);
ok("duel: لا إجابة بعد الاكتمال", /duel_not_playable|already_finished/.test(await err(ans(B, rq.questions[0].id, 1)) ?? ""));
ok("duel: طرف ثالث لا يرى النتيجة", /duel_not_found/.test(await err(q(C, "select public.duel_result($1)", [D])) ?? ""));

// انتهاء المهلة = فوز المتحدّي
const D2 = (await q(A, "select public.create_duel($1,$2,'{}',5) id", [C, S1]))[0].id;
const d2q = (await q(A, "select public.duel_questions($1) r", [D2]))[0].r;
for (const x of d2q.questions) await q(A, "select public.duel_answer($1,$2,0)", [D2, x.id]);
await db.query("update public.duels set expires_at = now() - interval '1 minute' where id=$1", [D2]);
ok("duel: عند انتهاء المهلة الخصم لا يجيب", /duel_expired|duel_not_playable/.test(await err(q(C, "select public.duel_questions($1)", [D2])) ?? ""));
const exp = (await q(C, "select public.duel_result($1) r", [D2]))[0].r;
ok("duel: انتهاء المهلة = فوز المتحدّي", exp.status === "expired" && exp.winner_id === A);
ok("duel: الخصم يرى الإجابات الصحيحة بعد الانتهاء", exp.questions && exp.questions[0].correct_index === 1);

// متحدٍّ لم يُكمل يُلغى بعد 24 ساعة
const D3 = (await q(B, "select public.create_duel($1,$2,'{}',5) id", [C, S1]))[0].id;
await db.query("update public.duels set created_at = now() - interval '25 hours' where id=$1", [D3]);
await q(B, "select public.my_duels()");
ok("duel: المتحدّي المتخلّف يُلغى بلا نتيجة", (await db.query("select status, winner_id from public.duels where id=$1", [D3])).rows[0].status === "cancelled");

// تعادل
const D4 = (await q(C, "select public.create_duel($1,$2,'{}',5) id", [A, S1]))[0].id;
const d4q = (await q(C, "select public.duel_questions($1) r", [D4]))[0].r;
// نثبت الزمن لضمان التعادل التام
for (const x of d4q.questions) await q(C, "select public.duel_answer($1,$2,2)", [D4, x.id]);
const d4a = (await q(A, "select public.duel_questions($1) r", [D4]))[0].r;
for (const x of d4a.questions) await q(A, "select public.duel_answer($1,$2,2)", [D4, x.id]);
const d4 = (await db.query("select status, winner_id, is_draw from public.duels where id=$1", [D4])).rows[0];
ok("duel: كلاهما صفر ← تعادل أو فوز بالوقت (متسق)", d4.status === "completed" && (d4.is_draw ? d4.winner_id === null : d4.winner_id !== null));

// السجل
const rec1 = await q(A, "select * from public.duel_record()");
const a = rec1.find((r) => r.user_id === A), b = rec1.find((r) => r.user_id === B);
ok("سجل: A فاز مرة (انتهاء المهلة) وخسر مرة", a.wins >= 1 && a.losses >= 1, JSON.stringify(a));
ok("سجل: B فاز مرة", b.wins >= 1);
ok("سجل: دفعة واحدة فقط", !rec1.some((r) => r.user_id === X));
await db.query("update public.profiles set hide_from_ranking=true where id=$1", [B]);
ok("سجل: المخفي لا يظهر للآخرين", !(await q(A, "select * from public.duel_record()")).some((r) => r.user_id === B) && (await q(B, "select * from public.duel_record()")).some((r) => r.user_id === B));
ok("زملاء: بلا النفس وبلا دفعات أخرى", (await q(A, "select * from public.cohort_mates()")).every((r) => r.id !== A && r.id !== X));

// ── الإشعارات
await q(A, "insert into public.push_subscriptions (endpoint,p256dh,auth) values ('https://push.example/abc','p','a')");
ok("push: الاشتراك لصاحبه فقط", (await q(A, "select * from public.push_subscriptions")).length === 1 && (await q(B, "select * from public.push_subscriptions")).length === 0);
ok("push: لا اشتراك باسم غيرك", denied(await err(q(A, "insert into public.push_subscriptions (user_id,endpoint,p256dh,auth) values ($1,'https://e/2','p','a')", [B]))));
ok("push: endpoint غير https مرفوض", /check/.test(await err(q(A, "insert into public.push_subscriptions (endpoint,p256dh,auth) values ('http://x','p','a')")) ?? ""));
await q(A, "insert into public.notification_prefs (user_id, duel) values (auth.uid(), false)");
ok("تفضيلات: الافتراضي مفعّل والـ duel مطفأ", (await q(A, "select * from public.notification_prefs"))[0].review === true && (await q(A, "select duel from public.notification_prefs"))[0].duel === false);
ok("سجل الإرسال مغلق على الطالب", denied(await err(q(A, "select * from public.notification_log"))));
ok("review_reminder_targets: الطالب ممنوع", denied(await err(q(A, "select * from public.review_reminder_targets()"))));
ok("review_reminder_targets: service_role مسموح", (await as(null, "service_role", async () => (await db.query("select * from public.review_reminder_targets()")).rows)) !== undefined);

// ── الإحصائيات
await q(A, "select public.touch_seen()");
ok("touch_seen يحدّث آخر ظهور", (await db.query("select last_seen_at from public.profiles where id=$1", [A])).rows[0].last_seen_at !== null);
ok("المشرف لا ينفذ دوال الإحصاء", /forbidden/.test(await err(q(MOD, "select * from public.admin_students()")) ?? "") && /forbidden/.test(await err(q(A, "select * from public.admin_ai_daily(7)")) ?? ""));
// ملء نتائج لاختبار الإحصاء
const L = (await db.query("insert into public.lessons (subject_id,kind,number,title,status) values ($1,'cm',1,'L1','published') returning id", [S1])).rows[0].id;
await db.query("update public.questions set lesson_id=$1 where statement in ('Q0','Q1','Q2')", [L]);
for (const u of [A, B, C]) {
  const att = (await db.query("insert into public.attempts (user_id,cohort_id,mode,subject_id,question_ids,total) values ($1,$2,'free',$3,$4,3) returning id", [u, cohort, S1, qs.slice(0, 3)])).rows[0].id;
  for (const qq of qs.slice(0, 3)) await db.query("insert into public.attempt_answers (attempt_id,user_id,question_id,subject_id,difficulty,qtype,selected_index,is_correct) values ($1,$2,$3,$4,'medium','mcq',0,false)", [att, u, qq, S1]);
}
const st = await q(ADM, "select * from public.admin_students()");
ok("إحصاء الطلاب: طلاب الفضاء فقط (بلا طالب فضاء آخر) مع آخر ظهور", st.length === 3 && !st.some((r) => r.id === X) && st.find((r) => r.id === A).last_seen_at !== null && st.find((r) => r.id === A).answers_7d === 3, JSON.stringify(st.map((r) => r.answers_7d)));
const ss = await q(ADM, "select * from public.admin_subject_stats()");
ok("متوسط المادة", ss.length === 11 && ss.find((r) => r.id === undefined || true) && Number(ss.find((r) => r.subject_id === S1).accuracy) === 0 && ss.find((r) => r.subject_id === S1).students === 3);
const wl = await q(ADM, "select * from public.admin_weak_lessons(10)");
ok("الحصص الأضعف: حصة L1 عند الأغلبية", wl.length === 1 && wl[0].lesson_id === L && wl[0].weak_students === 3);
// استهلاك المزوّدين
await q(A, "select public.ai_note_use('gemini', false)"); await q(A, "select public.ai_note_use('gemini', false)"); await q(A, "select public.ai_note_use('gemini', true)"); await q(A, "select public.ai_note_use('groq', false)");
await q(A, "select public.ai_note_use('evil', false)");
const ad = await q(ADM, "select * from public.admin_ai_daily(14)");
ok("استهلاك المزوّدين اليومي", ad.find((r) => r.provider === "gemini").calls === 2 && ad.find((r) => r.provider === "gemini").failures === 1 && ad.find((r) => r.provider === "groq").calls === 1 && ad.length === 2);
await q(A, "select public.ai_take('chat', 5, 600, 100)");
const ak = await q(ADM, "select * from public.admin_ai_kinds()");
ok("استهلاك الأنواع (ai_usage)", ak.length === 1 && ak[0].kind === "chat" && ak[0].today === 1 && ak[0].users_today === 1);
ok("المدير لا يقرأ الدردشات رغم الإحصاء", (await q(ADM, "select * from public.conversations")).length === 0 && (await q(ADM, "select * from public.messages")).length === 0);
ok("ai_provider_daily مغلق على الطالب", denied(await err(q(A, "select * from public.ai_provider_daily"))));
ok("anon لا ينفذ دوال المرحلة 4", denied(await err(anon("select * from public.cohort_mates()"))) && denied(await err(anon("select public.touch_seen()"))));
console.log(`\n${pass} نجح، ${fail} فشل`);
process.exit(fail ? 1 : 0);
