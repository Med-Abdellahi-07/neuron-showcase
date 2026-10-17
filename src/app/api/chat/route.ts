import { getUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorInfo, streamChat, type ChatMsg } from "@/lib/ai";
import { buildSystemPrompt, type ChatMode, type ContextChunk, type SourceRef } from "@/lib/ai/prompts";
import { retrieve } from "@/lib/ai/rag";
import { getLocale } from "@/lib/i18n/server";
import {
  GUIDED_ACTIONS,
  REVIEW_QUESTIONS,
  explainNote,
  fetchWindow,
  partSize,
  reviewNote,
  reviewPosition,
  solveNote,
  toContext,
  type GuidedAction,
} from "@/lib/ai/guided";
import { tavilySearch, type WebResult } from "@/lib/ai/tavily";
import { scrubPII } from "@/lib/ai/privacy";

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
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return json(401, { error: "unauthorized" });

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

  const { data: convRow } = await supabase
    .from("conversations")
    .select("id, subject_id, lesson_id, lesson_ids, question_id, mode, title, guided, cursor, total, step")
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
    .limit(12);
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

  const locale = await getLocale();
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
          modeNote = explainNote({ action, locale, part, parts, finished });
          send({ type: "progress", cursor: Math.min(cursor + (finished ? 0 : partRows.length), total), total, finished });
          userText = action === "start" ? "(start)" : text;
        } else if (conv.guided && mode === "review" && (action === "start" || action === "finish" || (!action && conv.step >= 1 && conv.step <= REVIEW_QUESTIONS))) {
          // ───────── مراجعة موجَّهة: سؤال واحد في كل مرة ─────────
          let total = conv.total;
          let step = conv.step;
          if (action === "start") {
            const first = await fetchWindow(supabase, scope, 0, 1);
            total = first[0]?.total ?? 0;
            if (total === 0) {
              send({ type: "error", code: "no_material" });
              return;
            }
            step = 1;
          }
          const rowsAll = [];
          const want: number[] = [];
          if (action === "start") want.push(1);
          else if (action === "finish") for (let k = 1; k <= Math.min(step, REVIEW_QUESTIONS); k++) want.push(k);
          else {
            want.push(step); // مادة السؤال الذي أجاب عنه الطالب
            if (step < REVIEW_QUESTIONS) want.push(step + 1);
          }
          for (const k of want) rowsAll.push(...(await fetchWindow(supabase, scope, reviewPosition(k, total), 2)));
          const ctx = toContext(rowsAll);
          chunks = ctx.chunks;
          sources = ctx.sources;
          relevant = true;
          // بنك الأسئلة يُستعمل لإلهام الأسئلة فقط؛ لا تُرسل الإجابات الصحيحة ولا الشروح
          let bank = "";
          if (action !== "finish") {
            let qb = supabase.from("questions").select("type, statement, options").eq("status", "published").limit(8);
            qb = lessonIds.length ? qb.in("lesson_id", lessonIds) : conv.subject_id ? qb.eq("subject_id", conv.subject_id) : qb;
            const { data: qs } = await qb;
            bank = (qs ?? [])
              .map((q, i) => `(${i + 1}) ${q.statement as string}${Array.isArray(q.options) ? " Options: " + (q.options as string[]).join(" | ") : ""}`)
              .join("\n");
          }
          const hasBank = bank.length > 0;
          const last = action === undefined || action === null ? step >= REVIEW_QUESTIONS : false;
          modeNote = reviewNote({ action: action === "start" ? "start" : action === "finish" ? "finish" : "answer", locale, k: step, last, hasBank });
          if (hasBank) extraContext = `QUESTION BANK (existing exercises, for inspiration only):\n${bank}`;
          if (action !== "start" && action !== "finish") {
            extraContext += `${extraContext ? "\n\n" : ""}(Excerpts are ordered: the first ones are the PREVIOUS QUESTION MATERIAL, the last ones the NEW MATERIAL.)`;
          }
          patch.total = total;
          patch.step = action === "finish" ? REVIEW_QUESTIONS + 1 : action === "start" ? 1 : last ? REVIEW_QUESTIONS + 1 : step + 1;
          send({ type: "step", step: patch.step, done: (patch.step as number) > REVIEW_QUESTIONS });
          userText = action === "start" ? "(start)" : action === "finish" ? text : text;
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
          modeNote = solveNote({ action: action ?? "answer", locale, exercise, reference, fromImage });
          userText = action === "start" ? (fromImage ? "(exercise in image)" : "(start)") : action === "hint" || action === "solution" ? text : text;
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
        const prior = history.map((m) => ({ role: m.role, text: scrubPII(m.content) }));
        if (prior.length && prior[0].role === "assistant") prior.unshift({ role: "user", text: "(start)" });
        const messages: ChatMsg[] = [
          ...prior,
          { role: "user", text: scrubPII(userText), images: images.length ? images : undefined },
        ];

        for await (const ev of streamChat({ system, messages, maxTokens: 3000, temperature: 0.3 })) {
          if (ev.type === "meta") {
            usedProvider = ev.used.provider;
            send({ type: "meta", provider: ev.used.provider, fellBack: !!ev.used.fellBackFrom });
          } else {
            answer += ev.text;
            send({ type: "delta", text: ev.text });
          }
        }

        await supabase.from("messages").insert({
          conversation_id: conv.id,
          role: "assistant",
          content: answer,
          sources: allSources.length ? allSources : null,
          provider: usedProvider,
        });
        if (!conv.title && text) patch.title = text.replace(/\s+/g, " ").slice(0, 60);
        await supabase.from("conversations").update(patch).eq("id", conv.id);
        send({ type: "done" });
      } catch (e) {
        const info = errorInfo(e);
        console.error("chat failed:", info.provider, info.status, info.message);
        // إن وصل جزء من الإجابة نحفظه ليبقى السجل متسقاً
        if (answer) {
          await supabase.from("messages").insert({ conversation_id: conv.id, role: "assistant", content: answer, provider: usedProvider });
        }
        send({ type: "error", code: "unavailable" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
