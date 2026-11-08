import { AiError, errorFromResponse } from "./errors";
import type { GenOpts } from "./gemini";

/** Groq (fallback) through its OpenAI-compatible API. */
const URL_ = (process.env.GROQ_BASE_URL?.trim() || "https://api.groq.com/openai/v1") + "/chat/completions"; // GROQ_BASE_URL: tests only.

export const groqModel = () => process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";
export const groqVisionModel = () => process.env.GROQ_VISION_MODEL?.trim() || "qwen/qwen3.8-27b";

function key(): string {
  const k = (process.env.GROQ_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new AiError("groq", 0, "GROQ_API_KEY غير مضبوط");
  return k;
}

/** Thinking models: the reasoning chain is hidden from the reply, and the token limit is raised because thinking counts toward it. */
const isOss = (m: string) => /gpt-oss/i.test(m);
const isQwen = (m: string) => /qwen/i.test(m);

function body(o: GenOpts, stream: boolean, extras = true) {
  const hasImages = o.messages.some((m) => m.images?.length);
  const model = hasImages ? groqVisionModel() : groqModel();
  const reasoning = isOss(model) || isQwen(model);
  return {
    model,
    stream,
    temperature: o.temperature ?? 0.4,
    max_tokens: (o.maxTokens ?? 2048) + (reasoning ? 1024 : 0),
    ...(extras && isOss(model) ? { include_reasoning: false, reasoning_effort: "low" } : {}),
    ...(extras && isQwen(model) ? { reasoning_format: "hidden" } : {}),
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

async function send(b: unknown): Promise<Response> {
  try {
    return await fetch(URL_, {
      method: "POST",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      body: JSON.stringify(b),
      signal: AbortSignal.timeout(55_000),
    });
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError("groq", 0, `تعذّر الاتصال بـ Groq: ${e instanceof Error ? e.message : e}`);
  }
}

async function post(o: GenOpts, stream: boolean): Promise<{ res: Response; model: string }> {
  const b = body(o, stream);
  let res = await send(b);
  if (res.status === 400) {
    // The model may reject the extra thinking fields: retry without them.
    const err = await errorFromResponse("groq", res);
    if (!/reason/i.test(err.message)) throw err;
    res = await send(body(o, stream, false));
  }
  if (!res.ok) throw await errorFromResponse("groq", res);
  return { res, model: b.model };
}

/** Removes <think>...</think> blocks if the model returned them inside the text (safety net). */
export const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*<think>[\s\S]*$/i, "").trim();

export async function groqGenerate(o: GenOpts): Promise<{ text: string; model: string }> {
  const { res, model } = await post(o, false);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = stripThink(j.choices?.[0]?.message?.content ?? "");
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
  let thinking = false;
  let pending = "";
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
          pending += t;
          let out = "";
          for (;;) {
            if (thinking) {
              const e = pending.indexOf("</think>");
              if (e < 0) { pending = pending.slice(-7); break; }
              pending = pending.slice(e + 8);
              thinking = false;
            } else {
              const b = pending.indexOf("<think>");
              if (b < 0) {
                // Keep a tail that may be the start of a tag.
                const keep = pending.lastIndexOf("<");
                if (keep >= 0 && "<think>".startsWith(pending.slice(keep))) { out += pending.slice(0, keep); pending = pending.slice(keep); } else { out += pending; pending = ""; }
                break;
              }
              out += pending.slice(0, b);
              pending = pending.slice(b + 7);
              thinking = true;
            }
          }
          if (out) {
            any = true;
            yield out;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }
  if (!any) throw new AiError("groq", 502, "رد Groq فارغ");
}
