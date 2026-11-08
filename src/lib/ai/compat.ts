import { AiError, errorFromResponse, type ProviderName } from "./errors";
import type { GenOpts } from "./gemini";

/**
 * Generic client for "OpenAI-compatible" APIs (OpenRouter, NVIDIA NIM and GitHub Models).
 * Each provider is defined by a small config; keys come from Vercel env vars only and are never printed or sent to the client.
 */
export interface CompatConfig {
  name: ProviderName;
  keyEnv: string;
  /** One model (<P>_MODEL variable) or an ordered list (..._MODELS variable, comma/newline separated) tried in order. */
  modelEnv: string;
  defaultModels: string[];
  /** Vision models (when images are present); no list means the provider does not accept images. */
  visionEnv?: string;
  defaultVisionModels?: string[];
  baseUrl: string; // Can be overridden with the <NAME>_BASE_URL variable (tests only).
  path?: string;
  /** Extra request fields (for example OpenRouter: opt out of content logging for training). */
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
}

const stripThink = (t: string) => t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^\s*<think>[\s\S]*$/i, "").trim();

export function compatProvider(c: CompatConfig) {
  const base = () => (process.env[`${c.keyEnv.replace(/_(API_KEY|TOKEN)$/, "")}_BASE_URL`]?.trim() || c.baseUrl) + (c.path ?? "/chat/completions");
  const key = () => (process.env[c.keyEnv] ?? "").trim().replace(/^["']|["']$/g, "");
  const list = (env: string | undefined, def: string[]) => {
    const v = env ? process.env[env]?.trim() : "";
    const items = (v ? v.split(/[,\n]/) : def).map((x) => x.trim()).filter(Boolean);
    return items.length ? items : def;
  };
  const hasImages = (o: GenOpts) => o.messages.some((m) => m.images?.length);
  const models = (o: GenOpts) => (hasImages(o) && c.defaultVisionModels ? list(c.visionEnv, c.defaultVisionModels) : list(c.modelEnv, c.defaultModels));
  const model = (o?: GenOpts) => models(o ?? { system: "", messages: [] })[0];
  const configured = () => !!key();

  function body(o: GenOpts, stream: boolean, m: string) {
    return {
      model: m,
      stream,
      temperature: o.temperature ?? 0.4,
      max_tokens: o.maxTokens ?? 2048,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      ...(c.extraBody ?? {}),
      messages: [
        { role: "system", content: o.system },
        ...o.messages.map((x) =>
          x.images?.length
            ? { role: x.role, content: [{ type: "text", text: x.text }, ...x.images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mime};base64,${im.data}` } }))] }
            : { role: x.role, content: x.text }
        ),
      ],
    };
  }

  async function post(o: GenOpts, stream: boolean, m: string): Promise<Response> {
    const k = key();
    if (!k) throw new AiError(c.name, 0, `${c.keyEnv} غير مضبوط`);
    let res: Response;
    try {
      res = await fetch(base(), {
        method: "POST",
        headers: { authorization: `Bearer ${k}`, "content-type": "application/json", ...(c.extraHeaders ?? {}) },
        body: JSON.stringify(body(o, stream, m)),
        signal: AbortSignal.timeout(45_000),
      });
    } catch (e) {
      throw new AiError(c.name, 0, `تعذّر الاتصال بـ ${c.name}: ${e instanceof Error ? e.message : e}`);
    }
    if (!res.ok) throw await errorFromResponse(c.name, res);
    return res;
  }

  async function one(o: GenOpts, m: string): Promise<{ text: string; model: string }> {
    const res = await post(o, false, m);
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = stripThink(j.choices?.[0]?.message?.content ?? "");
    if (!text) throw new AiError(c.name, 502, `رد ${c.name} (${m}) فارغ`);
    return { text, model: m };
  }

  /** Models in order: if the first fails (429/unavailable/empty) the next is tried; if all fail the last error is thrown. */
  async function generate(o: GenOpts): Promise<{ text: string; model: string }> {
    let last: unknown;
    for (const m of models(o)) {
      try {
        return await one(o, m);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  }

  async function* streamOne(o: GenOpts, m: string): AsyncGenerator<string> {
    const res = await post(o, true, m);
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
          // Thinking models may emit <think>...</think> in scattered chunks: strip them.
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
          /* ignore */
        }
      }
    }
    if (!any) throw new AiError(c.name, 502, `رد ${c.name} (${m}) فارغ`);
  }

  async function* stream(o: GenOpts): AsyncGenerator<string> {
    let last: unknown;
    for (const m of models(o)) {
      let started = false;
      try {
        for await (const t of streamOne(o, m)) {
          started = true;
          yield t;
        }
        return;
      } catch (e) {
        if (started) throw e; // Dropped after the reply started: do not repeat text to the student.
        last = e;
      }
    }
    throw last;
  }

  return { name: c.name, configured, model, models, generate, stream, keyEnv: c.keyEnv, modelEnv: c.modelEnv };
}

export const openrouter = compatProvider({
  name: "openrouter",
  keyEnv: "OPENROUTER_API_KEY",
  modelEnv: "OPENROUTER_CHAT_MODELS",
  // Free-tier model ids (verified from the /admin/ai test; a wrong id is skipped automatically in favour of the next).
  defaultModels: ["thinkingmachines/inkling:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3-ultra-550b-a55b:free", "thinkingmachines/inkling-small:free"],
  visionEnv: "OPENROUTER_VISION_MODELS",
  defaultVisionModels: ["thinkingmachines/inkling:free", "google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free"],
  baseUrl: "https://openrouter.ai/api/v1",
  // zdr: never retain data; data_collection:deny: no routing to a provider that trains on requests. If no matching endpoint exists the request fails and the system falls through to the next provider.
  extraBody: { provider: { zdr: true, data_collection: "deny" } },
  extraHeaders: { "X-Title": "Neuron" },
});
export const nvidia = compatProvider({
  name: "nvidia",
  keyEnv: "NVIDIA_API_KEY",
  modelEnv: "NVIDIA_MODEL",
  defaultModels: ["meta/llama-3.3-70b-instruct"],
  baseUrl: "https://integrate.api.nvidia.com/v1",
});
export const githubModels = compatProvider({
  name: "github",
  keyEnv: "GITHUB_MODELS_TOKEN",
  modelEnv: "GITHUB_MODELS_MODEL",
  defaultModels: ["openai/gpt-4.1-mini"],
  baseUrl: "https://models.github.ai/inference",
});
