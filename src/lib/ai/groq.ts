import { AiError, errorFromResponse } from "./errors";
import type { GenOpts } from "./gemini";

/** Groq (احتياطي) عبر واجهته المتوافقة مع OpenAI. */
const URL_ = (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1") + "/chat/completions"; // GROQ_BASE_URL: للاختبارات فقط

export const groqModel = () => process.env.GROQ_MODEL?.trim() || "llama-3.3-70b-versatile";
export const groqVisionModel = () => process.env.GROQ_VISION_MODEL?.trim() || "meta-llama/llama-4-scout-17b-16e-instruct";

function key(): string {
  const k = (process.env.GROQ_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new AiError("groq", 0, "GROQ_API_KEY غير مضبوط");
  return k;
}

function body(o: GenOpts, stream: boolean) {
  const hasImages = o.messages.some((m) => m.images?.length);
  return {
    model: hasImages ? groqVisionModel() : groqModel(),
    stream,
    temperature: o.temperature ?? 0.4,
    max_tokens: o.maxTokens ?? 2048,
    ...(o.json ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: o.system },
      ...o.messages.map((m) =>
        m.images?.length
          ? {
              role: m.role,
              content: [
                { type: "text", text: m.text },
                ...m.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } })),
              ],
            }
          : { role: m.role, content: m.text }
      ),
    ],
  };
}

async function post(o: GenOpts, stream: boolean): Promise<{ res: Response; model: string }> {
  const b = body(o, stream);
  let res: Response;
  try {
    res = await fetch(URL_, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("groq", 0, `تعذّر الاتصال بـ Groq: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw await errorFromResponse("groq", res);
  return { res, model: b.model };
}

export async function groqGenerate(o: GenOpts): Promise<{ text: string; model: string }> {
  const { res, model } = await post(o, false);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content ?? "";
  if (!text) throw new AiError("groq", 502, "رد Groq فارغ");
  return { text, model };
}

export async function* groqStream(o: GenOpts): AsyncGenerator<string> {
  const { res } = await post(o, true);
  if (!res.body) throw new AiError("groq", 502, "لا يوجد جسم للرد");
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
        const t = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
        if (t) {
          any = true;
          yield t;
        }
      } catch {
        /* تجاهل */
      }
    }
  }
  if (!any) throw new AiError("groq", 502, "رد Groq فارغ");
}
