// الدفعة أ (ذكاء اصطناعي): نقاط، أعلام لكل فضاء، ملخصات وQCM شخصي، عزل
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

// ══════════ الأعلام (الإطلاق التدريجي) ══════════
const fl = (await one("select ai_features from public.cohorts where id=$1", [IAA]));
ok("IAA L2 مفعّل افتراضياً بكل الأعلام بما فيها ai_exam", ["ai_chat", "ai_summary", "ai_qcm", "ai_duel", "ai_tools", "ai_exam"].every((k) => fl.ai_features[k] === true), JSON.stringify(fl));
ok("فضاء آخر (SDS L2) معطّل افتراضياً", (await n("select count(*) c from public.cohorts where id=$1 and ai_features = '{}'::jsonb", [SDS2])) === 1);
ok("my_ai_flag: طالب IAA نعم، طالب SDS لا", (await q(A, "select public.my_ai_flag('ai_chat') f"))[0].f === true && (await q(S, "select public.my_ai_flag('ai_chat') f"))[0].f === false);

// ══════════ السقف الخفي ضد الإساءة (لا نقاط ولا رصيد ظاهر) ══════════
let r = await spend(A, "chat");
ok("طلب عادي مقبول ولا يُرجع رصيداً للطالب", r.ok && r.remaining === undefined && r.limit === undefined, JSON.stringify(r));
ok("كل الأنواع تُقبل (ملخص/QCM) بلا تكلفة متفاوتة", (await spend(A, "summary")).ok && (await spend(A, "qcm")).ok && (await n("select sum(points) c from public.ai_ledger where user_id=$1", [A])) === 3);
ok("ai_balance لا يحوي عدّاداً (أعلام وضغط فقط)", (() => null)() === null && Object.keys((await q(A, "select public.ai_balance() b"))[0].b).sort().join() === "flags,pressure");
r = await spend(S, "chat");
ok("طالب في فضاء معطّل: refused disabled", !r.ok && r.reason === "disabled");
ok("نوع مجهول مرفوض", (await spend(A, "bogus")).reason === "unknown");
ok("بلا تسجيل دخول: auth", (await as(null, "authenticated", async () => (await db.query("select public.ai_spend('chat') r")).rows[0].r)).reason === "auth");
ok("الطالب لا يسترجع بنفسه", denied(await err(q(A, "select public.ai_refund(1)"))));
await svc("select public.ai_refund($1)", [(await spend(B, "chat")).ledger_id]);
ok("service_role يسترجع (يعود العدد)", (await n("select count(*) c from public.ai_ledger where user_id=$1", [B])) === 0);
// سقف الدقيقة (10 افتراضياً)
for (let i = 0; i < 7; i++) await spend(A, "chat"); // الإجمالي 10 في الدقيقة
r = await spend(A, "chat");
ok("الطلب الحادي عشر في الدقيقة: break مع alert", !r.ok && r.reason === "break" && r.alert === true, JSON.stringify(r));
r = await spend(A, "chat");
ok("التجاوز التالي: break بلا تنبيه مكرر", !r.ok && r.reason === "break" && r.alert === false);
ok("تنبيه واحد فقط مسجَّل", (await n("select count(*) c from public.ai_alerts where user_id=$1 and kind='minute'", [A])) === 1);
ok("B لا يتأثر بسقف A", (await spend(B, "chat")).ok);
// سقف اليوم: نخفّضه لاختبار سريع (الحد الأدنى 10) ونوزّع الطلبات خارج نافذة الدقيقة
await q(ADM, "select public.ai_set_limits(10, 120)");
ok("حدّ يومي 10 + دقيقة 120 يُحفظ", JSON.stringify((await q(ADM, "select public.ai_get_limits() l"))[0].l) === '{"daily_cap":10,"minute_cap":120,"pressure":1}' || (await q(ADM, "select public.ai_get_limits() l"))[0].l.daily_cap === 10);
r = await spend(A, "chat");
ok("سقف اليوم: break مع alert يومي", !r.ok && r.reason === "break" && r.alert === true && (await n("select count(*) c from public.ai_alerts where user_id=$1 and kind='daily'", [A])) === 1, JSON.stringify(r));
ok("الطالب لا يقرأ التنبيهات ولا السقوف", denied(await err(q(A, "select * from public.ai_alerts"))) && has(await err(q(A, "select public.ai_get_limits()")), "forbidden") && has(await err(q(SAI, "select * from public.ai_recent_alerts(7)")), "forbidden") && has(await err(q(A, "select * from public.ai_top_users(10)")), "forbidden"));
ok("المشرف العام يرى التنبيهات وأكثر الحسابات استهلاكاً", (await q(ADM, "select * from public.ai_recent_alerts(7)")).length === 2 && (await q(ADM, "select * from public.ai_top_users(10)"))[0].full_name === "a");
ok("قيم سقف غير صالحة مرفوضة", has(await err(q(ADM, "select public.ai_set_limits(5, 10)")), "invalid_limits") && has(await err(q(ADM, "select public.ai_set_limits(200, 0)")), "invalid_limits") && has(await err(q(SAI, "select public.ai_set_limits(200, 10)")), "forbidden"));
await q(ADM, "select public.ai_set_limits(200, 10)");
// وضع الضغط: يخفّض سقف اليوم الفعلي إلى 50% ← رسالة «مزدحم» لا «استراحة»
await db.query("update public.ai_settings set pressure = 0.5, daily_cap = 20");
const C = await mkP("c", "student", IAA);
await db.query("insert into public.ai_ledger (user_id, cohort_id, kind, points, at) select $1, $2, 'chat', 1, now() - interval '5 minutes' from generate_series(1, 12)", [C, IAA]);
r = await spend(C, "chat");
ok("وضع الضغط: 12 طلباً ≥ 10 (نصف 20) فتُرفض بـ busy لا break", !r.ok && r.reason === "busy" && r.alert === false, JSON.stringify(r));
ok("الطالب لا يعدّل وضع الضغط ولا الإعدادات", denied(await err(q(C, "update public.ai_settings set pressure = 1"))));
await db.query("update public.ai_settings set pressure = 1, daily_cap = 200, minute_cap = 10");
// أعلام الفضاء بلا نقاط
ok("غير المشرف العام لا يضبط الأعلام", has(await err(q(SAI, "select public.set_space_ai($1,'{}'::jsonb)", [IAA])), "forbidden") && has(await err(q(A, "select public.set_space_ai($1,'{}'::jsonb)", [IAA])), "forbidden"));
await db.query(`update public.cohorts set features = features || '{"ai":true}' where id=$1`, [SDS2]); // ميزة الخطة (المفتاح الرئيسي)
await q(ADM, "select public.set_space_ai($1, '{\"ai_chat\":true,\"ai_summary\":false,\"ai_exam\":true}'::jsonb)", [SDS2]);
const sf = await one("select ai_features from public.cohorts where id=$1", [SDS2]);
ok("المشرف العام يفعّل SDS L2: chat وexam فقط", sf.ai_features.ai_chat === true && sf.ai_features.ai_exam === true && sf.ai_features.ai_summary === false && sf.ai_features.ai_qcm === false);
ok("طالب SDS: الدردشة تعمل", (await spend(S, "chat")).ok);
ok("طالب SDS: الملخص معطّل بالعلم", (await spend(S, "summary")).reason === "disabled");
await db.query(`update public.cohorts set features = features || '{"ai":false}' where id=$1`, [SDS2]);
ok("تعطيل ميزة الخطة ai يعطّل كل الأعلام", (await spend(S, "chat")).reason === "disabled");
const us = await q(ADM, "select * from public.ai_space_usage(7)");
ok("ai_space_usage للمشرف العام يعرض IAA L2", us.some((x) => x.space_name === "IAA L2" && Number(x.points) > 0));
ok("ai_space_usage مرفوض لغير المشرف العام", has(await err(q(SAI, "select * from public.ai_space_usage(7)")), "forbidden"));
ok("عدّاد المزوّدين يقبل openrouter/nvidia/github", (await err(q(A, "select public.ai_note_use('openrouter'), public.ai_note_use('nvidia'), public.ai_note_use('github')"))) === null && (await n("select count(*) c from public.ai_provider_daily where provider in ('openrouter','nvidia','github')")) === 3);

// ══════════ الملخصات الشخصية ══════════
const sum = (u, coh, lessons, content = "ملخص") => q(u, "insert into public.ai_summaries (user_id, cohort_id, subject_id, lesson_ids, kind, lang, content) values ($1,$2,$3,$4,'short','fr',$5)", [u, coh, subI, lessons, content]);
ok("A يحفظ ملخصاً لدرس من فضائه", (await err(sum(A, IAA, [lessI], "ملخص A"))) === null);
ok("رفض: ملخص بدرس من فضاء آخر", (await err(sum(A, IAA, [lessS]))) !== null);
ok("رفض: ملخص باسم مستخدم آخر", (await err(q(A, "insert into public.ai_summaries (user_id, cohort_id, lesson_ids, kind, lang, content) values ($1,$2,$3,'short','fr','x')", [B, IAA, [lessI]]))) !== null);
ok("رفض: طالب فضاء بلا علم ai_summary", (await err(q(S, "insert into public.ai_summaries (user_id, cohort_id, lesson_ids, kind, lang, content) values ($1,$2,$3,'short','fr','x')", [S, SDS2, [lessS]]))) !== null);
ok("B لا يرى ملخص A", (await q(B, "select count(*)::int c from public.ai_summaries"))[0].c === 0);
ok("A يرى ملخصه", (await q(A, "select count(*)::int c from public.ai_summaries"))[0].c === 1);
ok("المشرف لا يقرأ ملخصات الطلاب", (await q(SAI, "select count(*)::int c from public.ai_summaries"))[0].c === 0);
ok("B لا يحذف ملخص A", ((await q(B, "delete from public.ai_summaries returning id")).length) === 0);

// ══════════ QCM الشخصي ══════════
const mkSet = async (u, coh, sub, lessons) => (await q(u, "insert into public.ai_qcm_sets (user_id, cohort_id, subject_id, kind, lesson_ids, question_count, difficulty) values ($1,$2,$3,'cm',$4,5,'medium') returning id", [u, coh, sub, lessons]))[0].id;
const setA = await mkSet(A, IAA, subI, [lessI]);
ok("A ينشئ مجموعة", !!setA);
ok("رفض: مجموعة بمادة/درس من فضاء آخر", (await err(mkSet(A, IAA, subS, [lessS]))) !== null);
const mkQ = (u, setId, opts = '["a","b","c","d"]', ci = 1) => q(u, "insert into public.ai_questions (set_id, user_id, subject_id, lesson_id, page, statement, options, correct_index, explanation) values ($1,$2,$3,$4,3,'S',$5,$6,'E') returning id", [setId, u, subI, lessI, opts, ci]);
const qa = (await mkQ(A, setA))[0].id;
ok("رفض: 3 خيارات فقط", (await err(mkQ(A, setA, '["a","b","c"]'))) !== null);
ok("رفض: correct_index=4", (await err(mkQ(A, setA, '["a","b","c","d"]', 4))) !== null);
ok("رفض: إدراج سؤال في مجموعة غيره", (await err(mkQ(B, setA))) !== null);
ok("B لا يرى سؤال A ولا مجموعته", (await q(B, "select count(*)::int c from public.ai_questions"))[0].c === 0 && (await q(B, "select count(*)::int c from public.ai_qcm_sets"))[0].c === 0);
ok("لا تحديث مباشر للأسئلة (is_correct)", denied(await err(q(A, "update public.ai_questions set is_correct = true where id=$1", [qa]))));
ok("B لا يجيب سؤال A", has(await err(q(B, "select public.ai_answer_question($1, 1)", [qa])), "not_found"));
let ans = (await q(A, "select public.ai_answer_question($1, 0) r", [qa]))[0].r;
ok("إجابة خاطئة: correct=false ومراجعة غداً", ans.correct === false && (await n("select count(*) c from public.ai_questions where id=$1 and due_at between now() + interval '23 hours' and now() + interval '25 hours' and not mastered", [qa])) === 1);
ans = (await q(A, "select public.ai_answer_question($1, 1) r", [qa]))[0].r;
ok("إجابة صحيحة: streak=1 والمراجعة بعد 3 أيام", ans.correct === true && (await n("select count(*) c from public.ai_questions where id=$1 and streak=1 and not mastered and due_at > now() + interval '2 days'", [qa])) === 1);
await q(A, "select public.ai_answer_question($1, 1)", [qa]);
ok("صحيحتان متتاليتان ← متقنة وبلا موعد", (await n("select count(*) c from public.ai_questions where id=$1 and mastered and due_at is null", [qa])) === 1);
ok("خيار خارج النطاق مرفوض", has(await err(q(A, "select public.ai_answer_question($1, 9)", [qa])), "invalid_choice"));
ok("الأسئلة لا تدخل review_queue ولا الترتيب المصنّف", (await n("select count(*) c from public.review_queue")) === 0 && (await n("select count(*) c from public.attempts")) === 0);

// الإبلاغ
await q(A, "select public.ai_report_question($1, 'الإجابة خاطئة')", [qa]);
const rep = await q(SAI, "select * from public.reported_ai_questions()");
ok("مشرف IAA يرى البلاغ دون هوية الطالب", rep.length === 1 && rep[0].note === "الإجابة خاطئة" && !("user_id" in rep[0]));
ok("مشرف فضاء آخر لا يرى البلاغ", (await q(SAS, "select * from public.reported_ai_questions()")).length === 0);
ok("طالب لا يستدعي قائمة البلاغات", has(await err(q(B, "select * from public.reported_ai_questions()")), "forbidden"));
ok("B لا يبلّغ عن سؤال A", has(await err(q(B, "select public.ai_report_question($1,'x')", [qa])), "not_found"));
ok("مشرف فضاء آخر لا يحسم البلاغ", has(await err(q(SAS, "select public.ai_resolve_report($1)", [qa])), "not_found"));
await q(SAI, "select public.ai_resolve_report($1)", [qa]);
ok("المشرف يحسم البلاغ ← reviewed", (await n("select count(*) c from public.ai_questions where id=$1 and report_status='reviewed'", [qa])) === 1);
ok("anon لا يصل لأي جدول جديد", denied(await err(anon("select * from public.ai_summaries"))) && denied(await err(anon("select * from public.ai_questions"))) && denied(await err(anon("select public.ai_spend('chat')"))));

console.log(`\n${pass} ناجح، ${fail} فاشل`);
process.exit(fail ? 1 : 0);
