import { AiError, errorInfo, type ErrorInfo } from "./errors";
import { geminiGenerate, geminiModel, geminiStream, type GenOpts } from "./gemini";
import { groqGenerate, groqModel, groqStream, groqVisionModel } from "./groq";

export type { ChatMsg, GenOpts } from "./gemini";
export { AiError, errorInfo, type ErrorInfo } from "./errors";

export interface Used {
  provider: "gemini" | "groq";
  model: string;
  /** إن فشل Gemini وانتقلنا إلى Groq: سبب الفشل */
  fellBackFrom?: ErrorInfo;
}

/**
 * فشل مفتاح/نموذج Gemini (401/403/404) لا يُصلح نفسه خلال ثوانٍ: نتجنّب دفع زمن محاولة فاشلة
 * مع كل رسالة عبر "قاطع دائرة" قصير داخل الذاكرة. الأخطاء المؤقتة (429/5xx) تُعاد محاولتها دوماً.
 */
let geminiBlockedUntil = 0;
let geminiBlockedWith: ErrorInfo | null = null;

function geminiSkipped(): ErrorInfo | null {
  return Date.now() < geminiBlockedUntil ? geminiBlockedWith : null;
}
function noteGeminiFailure(e: unknown): ErrorInfo {
  const info = errorInfo(e, "gemini");
  noteFailure(info);
  if ([401, 403, 404].includes(info.status)) {
    geminiBlockedUntil = Date.now() + 60_000;
    geminiBlockedWith = info;
  }
  return info;
}
const noteGeminiOk = () => {
  geminiBlockedUntil = 0;
  geminiBlockedWith = null;
};

/** إخفاقات المزوّدين منذ آخر تفريغ؛ يحفظها مسار الطلب في قاعدة البيانات لتظهر للمدير */
const failures: ErrorInfo[] = [];
const noteFailure = (i: ErrorInfo) => {
  if (failures.length < 10) failures.push(i);
};
export const drainFailures = (): ErrorInfo[] => failures.splice(0, failures.length);

const hasGroq = () => !!process.env.GROQ_API_KEY?.trim();

function pickErr(a: ErrorInfo, b: unknown): AiError {
  const bi = errorInfo(b, "groq");
  return new AiError(
    bi.provider,
    bi.status,
    `Gemini: ${a.status} ${a.message} | Groq: ${bi.status} ${bi.message}`,
    bi.reason
  );
}

/** توليد نص كامل: Gemini أولاً ثم Groq تلقائياً عند أي فشل. */
export async function generateText(o: GenOpts, opts: { skipBreaker?: boolean } = {}): Promise<{ text: string } & Used> {
  let gerr: ErrorInfo | null = (!opts.skipBreaker && geminiSkipped()) || null;
  if (!gerr) {
    try {
      const r = await geminiGenerate(o);
      noteGeminiOk();
      return { text: r.text, provider: "gemini", model: r.model };
    } catch (e) {
      gerr = noteGeminiFailure(e);
    }
  }
  if (!hasGroq()) throw new AiError("gemini", gerr.status, gerr.message, gerr.reason);
  try {
    const r = await groqGenerate(o);
    return { text: r.text, provider: "groq", model: r.model, fellBackFrom: gerr };
  } catch (e) {
    noteFailure(errorInfo(e, "groq"));
    throw pickErr(gerr, e);
  }
}

export async function generateJson<T>(o: GenOpts): Promise<{ data: T } & Used> {
  const r = await generateText({ ...o, json: true });
  const cleaned = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { data: JSON.parse(cleaned) as T, provider: r.provider, model: r.model, fellBackFrom: r.fellBackFrom };
  } catch {
    throw new AiError(r.provider, 502, "الرد ليس JSON صالحاً");
  }
}

export type StreamEvent = { type: "meta"; used: Used } | { type: "delta"; text: string };

/**
 * بثّ الرد. إن فشل Gemini قبل أول جزء ننتقل إلى Groq. إن انقطع بعد بدء الرد نرمي الخطأ
 * (لا نكرر نصاً على الطالب).
 */
export async function* streamChat(o: GenOpts): AsyncGenerator<StreamEvent> {
  let gerr: ErrorInfo | null = geminiSkipped();
  if (!gerr) {
    let started = false;
    try {
      for await (const t of geminiStream(o)) {
        if (!started) {
          started = true;
          noteGeminiOk();
          yield { type: "meta", used: { provider: "gemini", model: geminiModel() } };
        }
        yield { type: "delta", text: t };
      }
      return;
    } catch (e) {
      if (started) throw e;
      gerr = noteGeminiFailure(e);
    }
  }
  if (!hasGroq()) throw new AiError("gemini", gerr.status, gerr.message, gerr.reason);
  const model = o.messages.some((m) => m.images?.length) ? groqVisionModel() : groqModel();
  let started = false;
  try {
    for await (const t of groqStream(o)) {
      if (!started) {
        started = true;
        yield { type: "meta", used: { provider: "groq", model, fellBackFrom: gerr } };
      }
      yield { type: "delta", text: t };
    }
  } catch (e) {
    noteFailure(errorInfo(e, "groq"));
    if (!started) throw pickErr(gerr, e);
    throw e;
  }
}
