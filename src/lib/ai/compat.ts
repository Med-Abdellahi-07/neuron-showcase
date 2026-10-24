import { AiError, errorFromResponse, type ProviderName } from "./errors";
import type { GenOpts } from "./gemini";

/**
 * عميل عام لواجهات «OpenAI-compatible» (OpenRouter وNVIDIA NIM وGitHub Models وMistral).
 * كل مزوّد يُعرَّف بإعداد صغير؛ المفاتيح من متغيرات Vercel فقط ولا تُطبع ولا تُرسل للعميل.
 */
export interface CompatConfig {
  name: ProviderName;
  keyEnv: string;
  modelEnv: string;
  defaultModel: string;
  baseUrl: string; // يمكن تجاوزه بمتغير <NAME>_BASE_URL (للاختبارات فقط)
  path?: string;
  /** حقول إضافية في الطلب (مثلاً OpenRouter: منع تسجيل المحتوى للتدريب) */
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}

const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*<think>[\s\S]*$/i, "").trim();

export function compatProvider(c: CompatConfig) {
  const base = () => (process.env[`${c.keyEnv.replace(/_(API_KEY|TOKEN)$/, "")}_BASE_URL`]?.trim() || c.baseUrl) + (c.path ?? "/chat/completions");
  const key = () => (process.env[c.keyEnv] ?? "").trim().replace(/^["']|["']$/g, "");
  const model = () => process.env[c.modelEnv]?.trim() || c.defaultModel;
  const configured = () => !!key();

  function body(o: GenOpts, stream: boolean) {
    return {
      model: model(),
      stream,
      temperature: o.temperature ?? 0.4,
      max_tokens: o.maxTokens ?? 2048,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      ...(c.extraBody ?? {}),
      messages: [{ role: "system", content: o.system }, ...o.messages.map((m) => ({ role: m.role, content: m.text }))],
    };
  }

  async function post(o: GenOpts, stream: boolean): Promise<Response> {
    const k = key();
    if (!k) throw new AiError(c.name, 0, `${c.keyEnv} غير مضبوط`);
    let res: Response;
    try {
      res = await fetch(base(), {
        method: "POST",
        headers: { authorization: `Bearer ${k}`, "content-type": "application/json", ...(c.extraHeaders ?? {}) },
        body: JSON.stringify(body(o, stream)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new AiError(c.name, 0, `تعذّر الاتصال بـ ${c.name}: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) throw await errorFromResponse(c.name, res);
    return res;
  }

  async function generate(o: GenOpts): Promise<{ text: string; model: string }> {
    const res = await post(o, false);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = stripThink(j.choices?.[0]?.message?.content ?? "");
    if (!text) throw new AiError(c.name, 502, `رد ${c.name} فارغ`);
    return { text, model: model() };
  }

  async function* stream(o: GenOpts): AsyncGenerator<string> {
    const res = await post(o, true);
    if (!res.body) throw new AiError(c.name, 502, "لا يوجد جسم للرد");
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let any = false;
    let inThink = false;
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
          let t = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
          if (!t) continue;
          // نماذج التفكير قد تُدرج <think>…</think> في أجزاء متفرقة: نحجبها
          if (inThink || t.includes("<think>")) {
            const closed = t.includes("</think>");
            t = t.replace(/<think>[\s\S]*?<\/think>/g, "");
            if (!closed && (inThink || t.includes("<think>"))) {
              inThink = true;
              t = t.replace(/<think>[\s\S]*$/, "");
            } else if (inThink && closed) {
              inThink = false;
              t = t.replace(/^[\s\S]*?<\/think>/, "");
            }
          }
          if (t) {
            any = true;
            yield t;
          }
        } catch {
          /* تجاهل */
        }
      }
    }
    if (!any) throw new AiError(c.name, 502, `رد ${c.name} فارغ`);
  }

  return { name: c.name, configured, model, generate, stream, keyEnv: c.keyEnv, modelEnv: c.modelEnv };
}

export const openrouter = compatProvider({
  name: "openrouter",
  keyEnv: "OPENROUTER_API_KEY",
  modelEnv: "OPENROUTER_MODEL",
  defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
  baseUrl: "https://openrouter.ai/api/v1",
  // لا نسمح بتوجيه الطلب لمزوّد يسجّل المحتوى أو يدرّب عليه
  extraBody: { provider: { data_collection: "deny" } },
  extraHeaders: { "X-Title": "Neuron" },
});
export const nvidia = compatProvider({
  name: "nvidia",
  keyEnv: "NVIDIA_API_KEY",
  modelEnv: "NVIDIA_MODEL",
  defaultModel: "meta/llama-3.3-70b-instruct",
  baseUrl: "https://integrate.api.nvidia.com/v1",
});
export const githubModels = compatProvider({
  name: "github",
  keyEnv: "GITHUB_MODELS_TOKEN",
  modelEnv: "GITHUB_MODELS_MODEL",
  defaultModel: "openai/gpt-4.1-mini",
  baseUrl: "https://models.github.ai/inference",
});
export const mistral = compatProvider({
  name: "mistral",
  keyEnv: "MISTRAL_API_KEY",
  modelEnv: "MISTRAL_MODEL",
  defaultModel: "mistral-small-latest",
  baseUrl: "https://api.mistral.ai/v1",
});
