import { getUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorInfo, noteUse, streamChat, type ChatMsg } from "@/lib/ai";
import { flushAiStats } from "@/lib/ai/stats";
import { buildSystemPrompt, type ChatMode, type ContextChunk, type SourceRef } from "@/lib/ai/prompts";
import { retrieve } from "@/lib/ai/rag";
import {
  GUIDED_ACTIONS,
  NEUTRAL_COMMAND,
  REVIEW_QUESTIONS,
  explainNote,
  fetchWindow,
  partSize,
  reviewNote,
  reviewPosition,
  solveNote,
  toContext,
  type GuidedAction,
  type SessionLang,
  type WindowRow,
} from "@/lib/ai/guided";
import { MarkerFilter, entryFromRow, extractQuestion, parseMarkers, summaryNote, type ReviewEntry } from "@/lib/ai/review";
import { tavilySearch, type WebResult } from "@/lib/ai/tavily";
import { scrubPII } from "@/lib/ai/privacy";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { asSessionLang } from "@/lib/ai/lang";
import { featureEnabled } from "@/lib/spaces";
import { refundPoints, spendErrorCode, spendPoints } from "@/lib/ai/points";

/** نصوص الأزرار المحلية (ar/fr) → أوامر محايدة، لتفادي انجرار النموذج إلى لغة الأزرار */
const LABEL_TO_COMMAND = new Map<string, string>();
for (const loc of Object.values(dictionaries)) {
  for (const k of Object.keys(NEUTRAL_COMMAND)) {
    const label = (loc as Record<string, string>)[`chat.q.${k}`];
    if (label) LABEL_TO_COMMAND.set(label, NEUTRAL_COMMAND[k]);
  }
}

const GREETING =
  /^(?:(?:hi|hello|hey|salut|bonjour|bonsoir|coucou|merci|thanks?|ok|d'accord|ça va|ca va|مرحبا|مرحباً|السلام عليكم|سلام|أهلا|اهلا|أهلاً|صباح الخير|مساء الخير|شكرا|شكراً|يعطيك العافية|كيف حالك|كيف الحال|شلونك|هلا)(?:[\s,.!؟?،]|وسهلا|بك|ك|you|à tous|tout le monde)*)+$/i;
/** تحية أو مجاملة قصيرة: لا بحث في الدروس ولا شارة «خارج المنهج» */
function isSmallTalk(t: string): boolean {
  const s = t.trim();
  return s.length <= 40 && GREETING.test(s);
}

export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES: ChatMode[] = ["explain", "review", "solve"];
const MAX_TEXT = 4000;
const MAX_IMAGES = 2;
const MAX_IMAGE_B64 = 3_000_000; // ≈ 2.2MB بعد التصغير في المتصفح
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp"];

interface Body {
  conversationId?: string;
  text?: string;
  images?: { mime: string; data: string }[];
  deepen?: boolean;
  mode?: string;
  action?: string;
}

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

interface Conv {
  id: string;
  subject_id: string | null;
  lesson_id: string | null;
  lesson_ids: string[] | null;
  question_id: string | null;
  mode: ChatMode;
  title: string | null;
  guided: boolean;
  cursor: number;
  total: number;
  step: number;
  lang: string;
  review_log: ReviewEntry[] | null;
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return json(401, { error: "unauthorized" });
  if (!(await featureEnabled("ai"))) return json(403, { error: "feature_disabled" });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const action = (GUIDED_ACTIONS as string[]).includes(body.action ?? "") ? (body.action as GuidedAction) : null;
  const text = (body.text ?? "").trim();
  const images = (body.images ?? []).slice(0, MAX_IMAGES);
  if (!body.conversationId || !UUID_RE.test(body.conversationId)) return json(400, { error: "bad_request" });
  if (text.length > MAX_TEXT || (!text && action !== "start")) return json(400, { error: "bad_text" });
  if (images.some((i) => !IMAGE_MIMES.includes(i.mime) || typeof i.data !== "string" || i.data.length > MAX_IMAGE_B64))
    return json(400, { error: "bad_image" });

  const supabase = await createClient();

  // حدّ استعمال خفي: لا نعرض الأرقام للطالب
  const { data: allowed } = await supabase.rpc("ai_take", {
    p_kind: "chat",
    p_window_limit: 30,
    p_window_seconds: 600,
    p_day_limit: 300,
  });
  if (allowed !== true) return json(429, { error: "busy" });

  // نقاط الطالب اليومية (رسالة = نقطة) وعلم ai_chat لفضائه؛ التكلفة والحد من قاعدة البيانات
  const spent = await spendPoints(supabase, "chat");
  if (!spent.ok) return json(spent.reason === "disabled" ? 403 : 429, { error: spendErrorCode(spent), remaining: spent.remaining ?? 0 });
  const ledgerId = spent.ledgerId;

  const { data: convRow } = await supabase
    .from("conversations")
    .select("id, subject_id, lesson_id, lesson_ids, question_id, mode, title, guided, cursor, total, step, lang, review_log")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (!convRow) return json(404, { error: "not_found" });
  const conv = convRow as Conv;

  let mode = conv.mode;
  if (!conv.guided && body.mode && MODES.includes(body.mode as ChatMode) && body.mode !== mode) {
    mode = body.mode as ChatMode;
    await supabase.from("conversations").update({ mode }).eq("id", conv.id);
  }
  const lessonIds = conv.lesson_ids?.length ? conv.lesson_ids : conv.lesson_id ? [conv.lesson_id] : [];
  const scope = { subjectId: conv.subject_id, lessonIds };

  const { data: hist } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(conv.guided && mode === "explain" ? 4 : 12); // الشرح الموجَّه: كل جزء له مقاطعه، فلا حاجة لتاريخ طويل (توفير توكنات)
  const history = (hist ?? []).reverse() as { role: "user" | "assistant"; content: string }[];

  if (action === "start" && history.length > 0) return json(409, { error: "already_started" });
  if (action && action !== "start" && !conv.guided) return json(400, { error: "bad_request" });

  // الأزرار السريعة تُحفظ كرسالة طالب نصها الزر؛ بدء الجلسة لا يُحفظ له نص
  if (action !== "start") {
    await supabase.from("messages").insert({
      conversation_id: conv.id,
      role: "user",
      content: text,
      had_image: images.length > 0,
    });
  }

  const lang: SessionLang = asSessionLang(conv.lang);
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      let answer = "";
      let usedProvider: string | null = null;
      try {
        let chunks: ContextChunk[] = [];
        let sources: SourceRef[] = [];
        let relevant = false;
        let modeNote: string | undefined;
        let web: WebResult[] = [];
        let webNote = "";
        let smallTalk = false;
        let userText = text;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        let extraContext = "";
        let review: { log: ReviewEntry[]; total: number; rows: WindowRow[]; prevN: number; summaryOnly: boolean } | null = null;

        if (conv.guided && mode === "explain" && (action === "start" || action === "continue" || action === "more" || action === "example")) {
          // ───────── شرح موجَّه: نافذة المقاطع الحالية ─────────
          let cursor = conv.cursor;
          let total = conv.total;
          if (action === "start") {
            const first = await fetchWindow(supabase, scope, 0, 1);
            total = first[0]?.total ?? 0;
            cursor = 0;
            if (total === 0) {
              send({ type: "error", code: "no_material" });
              return;
            }
          }
          const rows = await fetchWindow(supabase, scope, cursor, 20);
          const curN = partSize(rows);
          let partRows = rows.slice(0, curN);
          if (action === "continue") {
            cursor += curN;
            partRows = rows.slice(curN, curN + partSize(rows.slice(curN)));
          }
          const finished = cursor >= total || partRows.length === 0;
          patch.cursor = cursor;
          patch.total = total;
          const ctx = toContext(partRows);
          chunks = ctx.chunks;
          sources = ctx.sources;
          relevant = chunks.length > 0;
          const parts = Math.max(1, Math.round(total / Math.max(1, curN)));
          const part = Math.min(parts, Math.round(cursor / Math.max(1, curN)) + 1);
          modeNote = explainNote({ action, lang, part, parts, finished });
          send({ type: "progress", cursor: Math.min(cursor + (finished ? 0 : partRows.length), total), total, finished });
          userText = action === "start" ? "(start)" : (NEUTRAL_COMMAND[action ?? ""] ?? text);
        } else if (conv.guided && mode === "review" && (action === "start" || action === "finish" || (!action && conv.step >= 1 && conv.step <= REVIEW_QUESTIONS))) {
          // ───────── مراجعة موجَّهة: أسئلة أصلية من نص الدرس، ومصدر كل سؤال ونتيجته يُسجَّلان ─────────
          const R = { log: [...(conv.review_log ?? [])], total: conv.total, rows: [] as WindowRow[], prevN: 0, summaryOnly: action === "finish" };
          review = R;
          if (action === "start") {
            const first = await fetchWindow(supabase, scope, 0, 1);
            R.total = first[0]?.total ?? 0;
            if (R.total === 0) {
              send({ type: "error", code: "no_material" });
              return;
            }
            R.log = [];
          }
          relevant = true;
          patch.total = R.total;
          if (!R.summaryOnly) {
            const prevRows: WindowRow[] = [];
            if (action !== "start") {
              const prev = R.log[conv.step - 1];
              if (prev) prevRows.push(...(await fetchWindow(supabase, scope, prev.ord, 2)));
            }
            const nextK = action === "start" ? 1 : conv.step + 1;
            const newRows = nextK <= REVIEW_QUESTIONS ? await fetchWindow(supabase, scope, reviewPosition(nextK, R.total), 2) : [];
            R.prevN = toContext(prevRows).rows.length;
            const ctx = toContext([...prevRows, ...newRows]);
            chunks = ctx.chunks;
            sources = ctx.sources;
            R.rows = ctx.rows;
            // بنك الأسئلة للإلهام فقط: مقتطفات قصيرة بلا خيارات ولا إجابات
            let qb = supabase.from("questions").select("statement").eq("status", "published").limit(6);
            qb = lessonIds.length ? qb.in("lesson_id", lessonIds) : conv.subject_id ? qb.eq("subject_id", conv.subject_id) : qb;
            const { data: qs } = await qb;
            const bank = (qs ?? []).map((q, i) => `(${i + 1}) ${(q.statement as string).replace(/\s+/g, " ").slice(0, 90)}…`).join("\n");
            modeNote = reviewNote({ action: action === "start" ? "start" : "answer", lang, k: conv.step, last: action !== "start" && conv.step >= REVIEW_QUESTIONS, hasBank: bank.length > 0 });
            if (bank) extraContext = `INSPIRATION ONLY (do not copy, do not reuse their wording):\n${bank}`;
            extraContext += `${extraContext ? "\n\n" : ""}${
              R.prevN > 0
                ? `EXCERPT ROLES: C1..C${R.prevN} = PREVIOUS QUESTION MATERIAL; C${R.prevN + 1}..C${R.rows.length} = NEW MATERIAL.`
                : "EXCERPT ROLES: all excerpts are NEW MATERIAL."
            }`;
          }
          send({ type: "step", step: action === "start" ? 1 : conv.step, done: false });
          userText = action === "start" ? "(start)" : text;
        } else if (conv.guided && mode === "solve" && (action === "start" || action === "hint" || action === "solution" || !action)) {
          // ───────── حل تمرين موجَّه ─────────
          let exercise: string | null = null;
          let reference: string | null = null;
          if (conv.question_id) {
            const { data: q } = await supabase
              .from("questions")
              .select("type, statement, options, model_answer")
              .eq("id", conv.question_id)
              .maybeSingle();
            if (q) {
              exercise = `${q.statement as string}${Array.isArray(q.options) ? "\nOptions:\n" + (q.options as string[]).map((o, i) => `${"ABCDEF"[i]}. ${o}`).join("\n") : ""}`;
              if (q.type === "written" && q.model_answer) reference = q.model_answer as string;
            }
          }
          const fromImage = action === "start" && !conv.question_id && images.length > 0;
          if (action === "start" && !exercise && !fromImage) {
            send({ type: "error", code: "no_exercise" });
            return;
          }
          // مقاطع الدرس المتعلقة بالتمرين
          const q = scrubPII([exercise ?? "", text].join(" ").trim()).slice(0, 1500);
          if (q) {
            const r = await retrieve(supabase, q, { subjectId: conv.subject_id, lessonId: lessonIds.length === 1 ? lessonIds[0] : null, lessonIds });
            chunks = r.chunks;
            sources = r.sources;
            relevant = r.relevant;
          }
          modeNote = solveNote({ action: action ?? "answer", lang, exercise, reference, fromImage });
          userText = action === "start" ? (fromImage ? "(exercise in image)" : "(start)") : NEUTRAL_COMMAND[action ?? ""] ?? text;
        } else {
          // ───────── سؤال حر (أي وضع) ─────────
          smallTalk = isSmallTalk(text) && images.length === 0;
          const lastUser = [...history].reverse().find((m) => m.role === "user");
          const query = scrubPII(text.length < 40 && lastUser ? `${lastUser.content} ${text}` : text);
          const retrieved = smallTalk
            ? { chunks: [], sources: [], relevant: false }
            : await retrieve(supabase, query, { subjectId: conv.subject_id, lessonId: lessonIds.length === 1 ? lessonIds[0] : null, lessonIds }, { k: body.deepen ? 8 : 5 });
          chunks = retrieved.chunks;
          sources = retrieved.sources;
          relevant = retrieved.relevant;

          if (!smallTalk && (body.deepen || !relevant) && process.env.TAVILY_API_KEY?.trim()) {
            const [{ data: okUser }, { data: globalCount }] = await Promise.all([
              supabase.rpc("ai_take", { p_kind: "web", p_window_limit: 4, p_window_seconds: 600, p_day_limit: 10 }),
              supabase.rpc("ai_global_count", { p_kind: "web", p_days: 30 }),
            ]);
            if (okUser === true && (globalCount ?? 0) < 900) {
              try {
                web = await tavilySearch(query);
                noteUse("tavily");
              } catch (e) {
                console.error("tavily failed:", errorInfo(e, "tavily").message);
              }
            } else if (body.deepen) {
              webNote = "Web search is temporarily unavailable; do not claim to have searched the internet.";
            }
          }
        }

        const allSources: SourceRef[] = [
          ...sources,
          ...web.map((w, i) => ({ id: `W${i + 1}`, kind: "web" as const, label: w.title, url: w.url })),
        ];
        send({ type: "sources", sources: allSources, outOfCurriculum: !smallTalk && !conv.guided && !relevant && web.length > 0 });

        // ───────── الطلب إلى النموذج: لا بيانات شخصية، فقط نص السؤال المنقّى ─────────
        const scopeNote = conv.lesson_id || lessonIds.length === 1
          ? "The student opened this chat from a specific lesson; the excerpts come from that lesson."
          : lessonIds.length > 1
            ? "The chat is about several selected lessons of one subject."
            : conv.subject_id
              ? "The chat is about one subject; the excerpts come from that subject."
              : "";
        const system =
          buildSystemPrompt({
            mode,
            course: chunks,
            web: web.map((w, i) => ({ id: `W${i + 1}`, title: w.title, url: w.url, text: w.content })),
            hasCourseMatch: relevant,
            smallTalk,
            deepen: !!body.deepen,
            modeNote,
            scopeNote: [scopeNote, webNote].filter(Boolean).join(" "),
          }) + (extraContext ? `\n\n${extraContext}` : "");

        // المحادثة يجب أن تبدأ بدور المستخدم
        const prior = history.map((m) => ({
          role: m.role,
          text: m.role === "user" ? (LABEL_TO_COMMAND.get(m.content) ?? scrubPII(m.content)) : scrubPII(m.content),
        }));
        if (prior.length && prior[0].role === "assistant") prior.unshift({ role: "user", text: "(start)" });
        const messages: ChatMsg[] = [
          ...prior,
          { role: "user", text: scrubPII(userText), images: images.length ? images : undefined },
        ];

        /** الملخص النهائي: حقائق السجل فقط (الأسئلة المطروحة فعلاً ومصادرها الحقيقية) */
        async function summarize(log: ReviewEntry[], total: number, msgs: ChatMsg[], pending = false) {
          const sums: ContextChunk[] = [];
          const srcs: SourceRef[] = [];
          for (let i = 0; i < log.length; i++) {
            const [row] = await fetchWindow(supabase, scope, log[i].ord, 1);
            sums.push({ id: `C${i + 1}`, label: log[i].label, text: row?.content ?? "" });
            srcs.push({ id: `C${i + 1}`, kind: "course", label: log[i].label, lessonId: log[i].lessonId, page: log[i].page });
          }
          let untested = "";
          const nextK = log.length + 1;
          if (nextK <= REVIEW_QUESTIONS && total > 0) {
            const rows = await fetchWindow(supabase, scope, reviewPosition(nextK, total), 2);
            untested = "UNTESTED MATERIAL:\n" + rows.map((r) => `[${r.lesson_kind.toUpperCase()} ${r.lesson_number} p. ${r.page}] ${r.content.slice(0, 600)}`).join("\n---\n");
          }
          const sys =
            buildSystemPrompt({ mode: "review", course: sums, web: [], hasCourseMatch: true, modeNote: summaryNote({ lang, log, pending }), scopeNote: "" }) +
            (untested ? `\n\n${untested}` : "");
          send({ type: "sources", sources: srcs, outOfCurriculum: false });
          const out = await generate(sys, msgs, true);
          await save(parseMarkers(out).clean, srcs);
        }

        const save = (content: string, srcs: SourceRef[]) =>
          supabase.from("messages").insert({
            conversation_id: conv.id,
            role: "assistant",
            content,
            sources: srcs.length ? srcs : null,
            provider: usedProvider,
          });

        /** يبث رد النموذج؛ في المراجعة تُحجب علامات [[...]] عن الطالب */
        async function generate(sys: string, msgs: ChatMsg[], hideMarkers: boolean): Promise<string> {
          const filter = hideMarkers ? new MarkerFilter() : null;
          let raw = "";
          answer = "";
          for await (const ev of streamChat({ system: sys, messages: msgs, maxTokens: conv.guided ? 1800 : 3000, temperature: 0.3 })) {
            if (ev.type === "meta") {
              usedProvider = ev.used.provider;
              send({ type: "meta", provider: ev.used.provider, fellBack: !!ev.used.fellBackFrom });
            } else {
              raw += ev.text;
              answer = raw;
              const out = filter ? filter.push(ev.text) : ev.text;
              if (out) send({ type: "delta", text: out });
            }
          }
          const rest = filter?.flush();
          if (rest) send({ type: "delta", text: rest });
          return raw;
        }

        const raw = await generate(system, messages, !!review && !review.summaryOnly);

        if (review && !review.summaryOnly) {
          // نسجّل نتيجة السؤال السابق ومصدر السؤال الجديد؛ وبعد السؤال الأخير يأتي الملخص مباشرة
          const { clean, markers } = parseMarkers(raw);
          await save(clean, allSources);
          answer = "";
          const R = review;
          const grading = action !== "start";
          if (grading) {
            const e = R.log[conv.step - 1];
            if (e) e.verdict = markers.verdict ?? "partial";
          }
          const newK = grading ? conv.step + 1 : 1;
          if (newK <= REVIEW_QUESTIONS) {
            const row = R.rows[(markers.src ?? R.prevN + 1) - 1] ?? R.rows[R.prevN] ?? R.rows[0];
            if (row) R.log.push(entryFromRow(newK, row, extractQuestion(clean, newK)));
          }
          patch.review_log = R.log;
          patch.step = grading ? Math.min(conv.step + 1, REVIEW_QUESTIONS + 1) : 1;
          send({ type: "step", step: patch.step as number, done: (patch.step as number) > REVIEW_QUESTIONS });
          if (grading && conv.step >= REVIEW_QUESTIONS) {
            await supabase.from("conversations").update(patch).eq("id", conv.id);
            send({ type: "next" });
            await summarize(R.log, R.total, [...messages, { role: "assistant", text: scrubPII(clean) }, { role: "user", text: "(summary)" }]);
            answer = "";
            send({ type: "done" });
            return;
          }
        } else if (review && review.summaryOnly) {
          const last = review.log[review.log.length - 1];
          await summarize(review.log, review.total, messages, !!last && last.verdict === null);
          answer = "";
          patch.step = REVIEW_QUESTIONS + 1;
          send({ type: "step", step: REVIEW_QUESTIONS + 1, done: true });
        } else {
          await save(raw, allSources);
          answer = "";
        }
        if (!conv.title && text) patch.title = text.replace(/\s+/g, " ").slice(0, 60);
        await supabase.from("conversations").update(patch).eq("id", conv.id);
        send({ type: "done" });
      } catch (e) {
        const info = errorInfo(e);
        console.error("chat failed:", info.provider, info.status, info.message);
        // إن وصل جزء من الإجابة نحفظه ليبقى السجل متسقاً
        if (answer) {
          await supabase.from("messages").insert({ conversation_id: conv.id, role: "assistant", content: parseMarkers(answer).clean, provider: usedProvider });
        }
        send({ type: "error", code: "unavailable" });
      } finally {
        // آخر أسباب فشل المزوّدين وعدّادات الاستهلاك تُحفظ لصفحة المدير
        await flushAiStats(supabase);
        if (!usedProvider) await refundPoints(ledgerId); // لم يُنتج أي مزوّد ردّاً (فشل أو لا مادة): لا نخصم نقاط الطالب
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
