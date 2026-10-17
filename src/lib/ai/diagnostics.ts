import { AiError, errorInfo, type ErrorInfo } from "./errors";
import { geminiEmbed, geminiGenerate, geminiModel, geminiEmbeddingModel } from "./gemini";
import { groqGenerate, groqModel, groqVisionModel } from "./groq";
import { tavilySearch } from "./tavily";
import { generateText } from "./index";

export interface DiagRow {
  id: string;
  label: string;
  ok: boolean;
  status: number | null; // رمز HTTP إن وُجد
  ms: number;
  model?: string;
  detail: string;
  hint?: string;
  /** يظهر بشكل بارز (مثلاً 401 من Gemini) */
  alert?: boolean;
}

export interface DiagReport {
  at: string;
  env: { name: string; set: boolean; value?: string }[];
  rows: DiagRow[];
}

function geminiHint(status: number, reason?: string): string | undefined {
  switch (status) {
    case 0:
      return "المفتاح غير مضبوط أو تعذّر الاتصال. تأكد من GEMINI_API_KEY في Vercel ثم أعد النشر (Redeploy).";
    case 401:
      return (
        "Gemini رفض المفتاح (401). تحقق من: (1) نسخ المفتاح كاملاً بلا مسافات أو علامات اقتباس؛ " +
        "(2) أنه أُنشئ في Google AI Studio ولم يُحذف؛ (3) أن النموذج GEMINI_MODEL ما زال متاحاً " +
        "(ظهر 401 مضلِّل مع نماذج قديمة مثل gemini-2.5-flash، جرّب gemini-3.6-flash)؛ " +
        "(4) أنك أعدت النشر بعد تعديل المتغير." +
        (reason ? ` السبب المعلن: ${reason}.` : "")
      );
    case 403:
      return "المفتاح معروف لكنه غير مصرّح له: قد تكون الخدمة معطّلة للمشروع أو للمفتاح قيود (IP/تطبيق).";
    case 404:
      return `النموذج غير موجود أو أُوقف (${geminiModel()}). غيّر GEMINI_MODEL إلى نموذج Flash متاح.`;
    case 429:
      return "تجاوزت حدّ الطلبات المجانية مؤقتاً. سيحوّل النظام تلقائياً إلى Groq.";
    case 502:
      return "ردّ Gemini بلا نص. انظر finishReason: MAX_TOKENS = استهلك التفكير الحد؛ SAFETY/PROHIBITED = حظر سلامة؛ STOP مع thoughtsTokens كبير = راجع GEMINI_MODEL. يحوّل النظام تلقائياً إلى Groq.";
    default:
      return status >= 500 ? "عطل مؤقت عند Google. سيحوّل النظام تلقائياً إلى Groq." : undefined;
  }
}

function hintFor(info: ErrorInfo): string | undefined {
  if (info.provider === "gemini") return geminiHint(info.status, info.reason);
  if (info.provider === "groq") {
    if (info.status === 0) return "GROQ_API_KEY غير مضبوط في Vercel.";
    if (info.status === 401) return "Groq رفض المفتاح (401): تحقق من GROQ_API_KEY.";
    if (info.status === 404)
      return `النموذج غير موجود أو أُوقف (${groqModel()} / رؤية: ${groqVisionModel()}). أوقفت Groq بعض النماذج (مثل llama-3.3-70b-versatile في 16/08/2026). غيّر GROQ_MODEL إلى openai/gpt-oss-120b وGROQ_VISION_MODEL إلى qwen/qwen3.8-27b في Vercel ثم أعد النشر.`;
    if (info.status === 400) return "طلب مرفوض: تحقق من اسم النموذج GROQ_MODEL / GROQ_VISION_MODEL وأنه يدعم الميزة المطلوبة.";
  }
  if (info.provider === "tavily") {
    if (info.status === 0) return "TAVILY_API_KEY غير مضبوط.";
    if (info.status === 401) return "Tavily رفض المفتاح (401): تحقق من TAVILY_API_KEY.";
  }
  return undefined;
}

async function timed(
  id: string,
  label: string,
  fn: () => Promise<{ detail: string; model?: string; ok?: boolean; hint?: string; alert?: boolean }>
): Promise<DiagRow> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { id, label, ok: r.ok ?? true, status: 200, ms: Date.now() - t0, model: r.model, detail: r.detail, hint: r.hint, alert: r.alert };
  } catch (e) {
    const info = errorInfo(e);
    return {
      id,
      label,
      ok: false,
      status: e instanceof AiError ? info.status : null,
      ms: Date.now() - t0,
      detail: `${info.status || "—"} ${info.message}`.slice(0, 1600),
      hint: hintFor(info),
      alert: info.provider === "gemini" && info.status === 401,
    };
  }
}

const ping = { system: "You are a connectivity probe. Reply with exactly: OK", messages: [{ role: "user" as const, text: "ping" }], maxTokens: 64, temperature: 0 };

export async function runDiagnostics(): Promise<DiagReport> {
  const present = (n: string) => !!process.env[n]?.trim();
  const env = [
    { name: "GEMINI_API_KEY", set: present("GEMINI_API_KEY") },
    { name: "GROQ_API_KEY", set: present("GROQ_API_KEY") },
    { name: "TAVILY_API_KEY", set: present("TAVILY_API_KEY") },
    { name: "SUPABASE_SERVICE_ROLE_KEY", set: present("SUPABASE_SERVICE_ROLE_KEY") },
    { name: "GEMINI_MODEL", set: present("GEMINI_MODEL"), value: geminiModel() },
    { name: "GEMINI_EMBEDDING_MODEL", set: present("GEMINI_EMBEDDING_MODEL"), value: geminiEmbeddingModel() },
    { name: "GROQ_MODEL", set: present("GROQ_MODEL"), value: groqModel() },
    { name: "GROQ_VISION_MODEL", set: present("GROQ_VISION_MODEL"), value: groqVisionModel() },
  ];

  const rows = await Promise.all([
    timed("gemini", "Gemini — توليد نص (مباشر، بلا احتياطي)", async () => {
      const r = await geminiGenerate(ping);
      return { detail: `رد: «${r.text.trim().slice(0, 60)}»`, model: r.model };
    }),
    timed("gemini-embed", "Gemini — التضمين (للبحث في الدروس)", async () => {
      const v = await geminiEmbed(["test"], "RETRIEVAL_QUERY");
      return { detail: `بُعد المتجه ${v[0].length}`, model: geminiEmbeddingModel() };
    }),
    timed("groq", "Groq — توليد نص (مباشر)", async () => {
      const r = await groqGenerate(ping);
      return { detail: `رد: «${r.text.trim().slice(0, 60)}»`, model: r.model };
    }),
    timed("tavily", "Tavily — بحث الإنترنت", async () => {
      const r = await tavilySearch("Neuron connectivity test", 1);
      return { detail: `${r.length} نتيجة` };
    }),
    timed("fallback", "المسار الفعلي للتطبيق (Gemini ثم Groq)", async () => {
      const r = await generateText(ping, { skipBreaker: true });
      if (r.provider === "gemini") return { detail: "أجاب Gemini مباشرة.", model: r.model };
      const f = r.fellBackFrom;
      return {
        detail: `أجاب Groq لأن Gemini فشل (${f?.status ?? "—"}: ${f?.message ?? ""})`.slice(0, 400),
        model: r.model,
        ok: true,
        hint: f ? geminiHint(f.status, f.reason) : undefined,
        alert: f?.status === 401,
      };
    }),
    timed("fallback-forced", "اختبار التحويل التلقائي (فشل Gemini مُفتعل بمفتاح خاطئ)", async () => {
      const r = await generateText({ ...ping, apiKeyOverride: "invalid-key-for-fallback-test" }, { skipBreaker: true });
      if (r.provider !== "groq") return { ok: false, detail: "لم يحدث تحويل!" , model: r.model };
      return {
        detail: `نجح التحويل: Gemini أعاد ${r.fellBackFrom?.status} فأجاب Groq.`,
        model: r.model,
      };
    }),
  ]);

  return { at: new Date().toISOString(), env, rows };
}
