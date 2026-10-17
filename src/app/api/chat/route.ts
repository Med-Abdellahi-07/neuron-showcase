import { getUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { errorInfo, streamChat, type ChatMsg } from "@/lib/ai";
import { buildSystemPrompt, type ChatMode, type SourceRef } from "@/lib/ai/prompts";
import { retrieve } from "@/lib/ai/rag";
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
}

const json = (status: number, obj: unknown) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return json(401, { error: "unauthorized" });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "bad_request" });
  }
  const text = (body.text ?? "").trim();
  const images = (body.images ?? []).slice(0, MAX_IMAGES);
  if (!body.conversationId || !UUID_RE.test(body.conversationId)) return json(400, { error: "bad_request" });
  if (!text || text.length > MAX_TEXT) return json(400, { error: "bad_text" });
  if (images.some((i) => !IMAGE_MIMES.includes(i.mime) || typeof i.data !== "string" || i.data.length > MAX_IMAGE_B64))
    return json(400, { error: "bad_image" });

  const supabase = await createClient();

  // حدّ استعمال خفي: لا نعرض الأرقام للطالب
  const { data: allowed } = await supabase.rpc("ai_take", {
    p_kind: "chat",
    p_window_limit: 20,
    p_window_seconds: 600,
    p_day_limit: 250,
  });
  if (allowed !== true) return json(429, { error: "busy" });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, subject_id, lesson_id, mode, title")
    .eq("id", body.conversationId)
    .maybeSingle();
  if (!conv) return json(404, { error: "not_found" });

  let mode = conv.mode as ChatMode;
  if (body.mode && MODES.includes(body.mode as ChatMode) && body.mode !== mode) {
    mode = body.mode as ChatMode;
    await supabase.from("conversations").update({ mode }).eq("id", conv.id);
  }

  const { data: hist } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(12);
  const history = (hist ?? []).reverse() as { role: "user" | "assistant"; content: string }[];

  await supabase.from("messages").insert({
    conversation_id: conv.id,
    role: "user",
    content: text,
    had_image: images.length > 0,
  });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      let answer = "";
      let usedProvider: string | null = null;
      try {
        // ───────── 1) مقاطع الدروس ─────────
        const lastUser = [...history].reverse().find((m) => m.role === "user");
        const query = scrubPII(text.length < 40 && lastUser ? `${lastUser.content} ${text}` : text);
        const smallTalk = isSmallTalk(text) && images.length === 0;
        const retrieved = smallTalk
          ? { chunks: [], sources: [], mode: "none" as const, relevant: false, debug: null }
          : await retrieve(supabase, query, { subjectId: conv.subject_id, lessonId: conv.lesson_id });

        // ───────── 2) بحث الإنترنت (للتعمق، أو عند غياب مقطع مرتبط) ─────────
        let web: WebResult[] = [];
        let webNote = "";
        if (!smallTalk && (body.deepen || !retrieved.relevant) && process.env.TAVILY_API_KEY?.trim()) {
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

        const sources: SourceRef[] = [
          ...retrieved.sources,
          ...web.map((w, i) => ({ id: `W${i + 1}`, kind: "web" as const, label: w.title, url: w.url })),
        ];
        send({ type: "sources", sources, outOfCurriculum: !smallTalk && !retrieved.relevant && web.length > 0 });

        // ───────── 3) الطلب إلى النموذج: لا بيانات شخصية، فقط نص السؤال المنقّى ─────────
        const scope = conv.lesson_id
          ? "The student opened this chat from a specific lesson; the excerpts come from that lesson."
          : conv.subject_id
            ? "The chat is about one subject; the excerpts come from that subject."
            : "";
        const system = buildSystemPrompt({
          mode,
          course: retrieved.chunks,
          web: web.map((w, i) => ({ id: `W${i + 1}`, title: w.title, url: w.url, text: w.content })),
          hasCourseMatch: retrieved.relevant,
          smallTalk,
          deepen: !!body.deepen,
          scopeNote: [scope, webNote].filter(Boolean).join(" "),
        });
        const messages: ChatMsg[] = [
          ...history.map((m) => ({ role: m.role, text: scrubPII(m.content) })),
          { role: "user", text: scrubPII(text), images: images.length ? images : undefined },
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
          sources: sources.length ? sources : null,
          provider: usedProvider,
        });
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (!conv.title) patch.title = text.replace(/\s+/g, " ").slice(0, 60);
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
