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

function toBody(o: GenOpts) {
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
      maxOutputTokens: o.maxTokens ?? 2048,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
}

type Part = { text?: string; thought?: boolean };
const textOf = (j: { candidates?: { content?: { parts?: Part[] } }[] }) =>
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

export async function geminiGenerate(o: GenOpts): Promise<{ text: string; model: string }> {
  const model = geminiModel();
  const res = await post(`models/${model}:generateContent`, toBody(o), key(o.apiKeyOverride), AbortSignal.timeout(50_000));
  const text = textOf(await res.json());
  if (!text) throw new AiError("gemini", 502, "رد Gemini فارغ");
  return { text, model };
}

/** بثّ النص تدريجياً (SSE). يرمي AiError قبل أول جزء إن فشل الطلب. */
export async function* geminiStream(o: GenOpts): AsyncGenerator<string> {
  const model = geminiModel();
  const res = await post(`models/${model}:streamGenerateContent?alt=sse`, toBody(o), key(o.apiKeyOverride), AbortSignal.timeout(55_000));
  if (!res.body) throw new AiError("gemini", 502, "لا يوجد جسم للرد");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let any = false;
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
        const t = textOf(JSON.parse(payload));
        if (t) {
          any = true;
          yield t;
        }
      } catch {
        /* جزء غير مكتمل: تجاهل */
      }
    }
  }
  if (!any) throw new AiError("gemini", 502, "رد Gemini فارغ");
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
