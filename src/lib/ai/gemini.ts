import { AiError, errorFromResponse } from "./errors";

/**
 * Gemini عبر REST الرسمي (generativelanguage.googleapis.com) والمفتاح في الترويسة x-goog-api-key.
 * لا نضع المفتاح في الرابط (?key=) ولا نستعمل نقطة OpenAI-compatible، ولا نفحص بادئة المفتاح.
 */
const BASE = process.env.GEMINI_BASE_URL?.trim() || "https://generativelanguage.googleapis.com/v1beta"; // GEMINI_BASE_URL: للاختبارات فقط

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
export const geminiEmbeddingModel = () => process.env.GEMINI_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

export interface ChatMsg {
  role: "user" | "assistant";
  text: string;
  images?: { mime: string; data: string }[]; // base64 بلا بادئة data:
}

export interface GenOpts {
  system: string;
  messages: ChatMsg[];
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
  /**
   * هل تحتوي الرسائل على بيانات الطالب (أسئلته، دروسه، أخطاؤه)؟ الافتراضي نعم.
   * false فقط للمحتوى العام (أسئلة Duel من الدروس): الوحيد المسموح بإرساله إلى Mistral (Experiment) الذي قد يُدرَّب على مدخلاته.
   */
  personal?: boolean;
  /** للاختبار فقط: مفتاح بديل (مثلاً مفتاح خاطئ لمحاكاة الفشل) */
  apiKeyOverride?: string;
}

function key(override?: string): string {
  const k = (override ?? process.env.GEMINI_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new AiError("gemini", 0, "GEMINI_API_KEY غير مضبوط");
  return k;
}

function headers(apiKey: string): Record<string, string> {
  return { "x-goog-api-key": apiKey, "content-type": "application/json" };
}

/** تفكير خفيف: Gemini 3 يستعمل thinkingLevel، و2.5 يستعمل thinkingBudget */
function thinking(on: boolean): { thinkingConfig: Record<string, unknown> } | undefined {
  if (!on) return undefined;
  const m = geminiModel();
  if (/gemini-3/.test(m)) return { thinkingConfig: { thinkingLevel: "low" } };
  if (/gemini-2\.5-flash/.test(m)) return { thinkingConfig: { thinkingBudget: 0 } };
  return undefined;
}

function toBody(o: GenOpts, thinkingOn = true) {
  return {
    systemInstruction: { parts: [{ text: o.system }] },
    contents: o.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.images ?? []).map((im) => ({ inlineData: { mimeType: im.mime, data: im.data } })),
        { text: m.text },
      ],
    })),
    generationConfig: {
      temperature: o.temperature ?? 0.4,
      // نماذج التفكير تحسب «التفكير» ضمن حد المخرجات؛ نمنحها هامشاً كي لا يبقى النص فارغاً
      maxOutputTokens: (o.maxTokens ?? 2048) + (thinking(thinkingOn) ? 1024 : 0),
      ...(thinking(thinkingOn) ?? {}),
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

type Part = { text?: string; thought?: boolean };
type GenJson = {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { thoughtsTokenCount?: number; candidatesTokenCount?: number };
};

/** وصف الرد الفارغ: سبب الإنهاء، الحظر، رموز التفكير، والرد الخام */
function emptyError(j: GenJson): AiError {
  const finish = j.candidates?.[0]?.finishReason;
  const block = j.promptFeedback?.blockReason;
  const raw = JSON.stringify(j).slice(0, 700);
  const msg = `رد Gemini فارغ — finishReason=${finish ?? "—"}${block ? ` blockReason=${block}` : ""} thoughtsTokens=${j.usageMetadata?.thoughtsTokenCount ?? "—"} model=${geminiModel()} | raw: ${raw}`;
  return new AiError("gemini", 502, msg, finish ?? block);
}
const textOf = (j: GenJson) =>
  (j.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");

async function post(path: string, body: unknown, apiKey: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, { method: "POST", headers: headers(apiKey), body: JSON.stringify(body), signal });
  } catch (e) {
    throw new AiError("gemini", 0, `تعذّر الاتصال بـ Gemini: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw await errorFromResponse("gemini", res);
  return res;
}

/** إن رفض النموذج حقل thinkingConfig (400) نعيد المحاولة بدونه */
async function postGen(path: string, o: GenOpts, apiKey: string, timeoutMs: number): Promise<Response> {
  try {
    return await post(path, toBody(o, true), apiKey, AbortSignal.timeout(timeoutMs));
  } catch (e) {
    if (e instanceof AiError && e.status === 400 && /thinking/i.test(e.message) && thinking(true)) {
      return post(path, toBody(o, false), apiKey, AbortSignal.timeout(timeoutMs));
    }
    throw e;
  }
}

export async function geminiGenerate(o: GenOpts): Promise<{ text: string; model: string }> {
  const model = geminiModel();
  const res = await postGen(`models/${model}:generateContent`, o, key(o.apiKeyOverride), 50_000);
  const j = (await res.json()) as GenJson;
  const text = textOf(j);
  if (!text) throw emptyError(j);
  return { text, model };
}

/** بثّ النص تدريجياً (SSE). يرمي AiError قبل أول جزء إن فشل الطلب. */
export async function* geminiStream(o: GenOpts): AsyncGenerator<string> {
  const model = geminiModel();
  const res = await postGen(`models/${model}:streamGenerateContent?alt=sse`, o, key(o.apiKeyOverride), 55_000);
  if (!res.body) throw new AiError("gemini", 502, "لا يوجد جسم للرد");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let any = false;
  let last: GenJson = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload) as GenJson;
        last = chunk;
        const t = textOf(chunk);
        if (t) {
          any = true;
          yield t;
        }
      } catch {
        /* جزء غير مكتمل: تجاهل */
      }
    }
  }
  if (!any) throw emptyError(last);
}

const l2 = (v: number[]) => {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
};

/** تضمينات نصية (768 بعداً، مُطبَّعة يدوياً كما تشترط Google لما دون 3072). */
export async function geminiEmbed(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY",
  apiKeyOverride?: string
): Promise<number[][]> {
  const apiKey = key(apiKeyOverride);
  const model = geminiEmbeddingModel();
  const out: number[][] = [];
  const BATCH = 50;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await post(
      `models/${model}:batchEmbedContents`,
      {
        requests: slice.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t }] },
          taskType,
          outputDimensionality: EMBEDDING_DIMENSIONS,
        })),
      },
      apiKey,
      AbortSignal.timeout(50_000)
    );
    const j = (await res.json()) as { embeddings?: { values: number[] }[] };
    if (!j.embeddings || j.embeddings.length !== slice.length) throw new AiError("gemini", 502, "رد التضمين غير مكتمل");
    for (const e of j.embeddings) {
      if (e.values.length !== EMBEDDING_DIMENSIONS) throw new AiError("gemini", 502, `بُعد التضمين ${e.values.length} بدل ${EMBEDDING_DIMENSIONS}`);
      out.push(l2(e.values));
    }
  }
  return out;
}
