import { AiError, errorInfo, type ErrorInfo } from "./errors";
import { geminiEmbed, geminiGenerate, geminiModel, geminiEmbeddingModel } from "./gemini";
import { groqGenerate, groqModel, groqVisionModel } from "./groq";
import { tavilySearch } from "./tavily";
import { generateText, type LlmProvider } from "./index";
import { githubModels, nvidia, openrouter } from "./compat";
import { getAdminT, type AdminT } from "@/lib/i18n/admin-t";

export interface DiagRow {
  id: string;
  label: string;
  ok: boolean;
  status: number | null; // HTTP status code, if any.
  ms: number;
  model?: string;
  detail: string;
  hint?: string;
  /** Shown prominently (for example a 401 from Gemini). */
  alert?: boolean;
}

export interface DiagReport {
  at: string;
  env: { name: string; set: boolean; value?: string }[];
  rows: DiagRow[];
}

function geminiHint(status: number, t: AdminT, reason?: string): string | undefined {
  switch (status) {
    case 0:
      return t("diag.gemini.noKey");
    case 401:
      return t("diag.gemini.401") + (reason ? ` ${t("diag.gemini.reason", { reason })}` : "");
    case 403:
      return t("diag.gemini.403");
    case 404:
      return t("diag.gemini.404", { model: geminiModel() });
    case 429:
      return t("diag.gemini.429");
    case 502:
      return t("diag.gemini.502");
    default:
      return status >= 500 ? t("diag.gemini.5xx") : undefined;
  }
}

function hintFor(info: ErrorInfo, t: AdminT): string | undefined {
  if (info.provider === "gemini") return geminiHint(info.status, t, info.reason);
  if (info.provider === "groq") {
    if (info.status === 0) return t("diag.groq.noKey");
    if (info.status === 401) return t("diag.groq.401");
    if (info.status === 404) return t("diag.groq.404", { model: groqModel(), vision: groqVisionModel() });
    if (info.status === 400) return t("diag.groq.400");
  }
  if (info.provider === "tavily") {
    if (info.status === 0) return t("diag.tavily.noKey");
    if (info.status === 401) return t("diag.tavily.401");
  }
  return undefined;
}

async function timed(
  t: AdminT,
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
      hint: hintFor(info, t),
      alert: info.provider === "gemini" && info.status === 401,
    };
  }
}

const ping = { system: "You are a connectivity probe. Reply with exactly: OK", messages: [{ role: "user" as const, text: "ping" }], maxTokens: 64, temperature: 0 };

export async function runDiagnostics(): Promise<DiagReport> {
  const t = await getAdminT();
  const present = (n: string) => !!process.env[n]?.trim();
  const env = [
    { name: "GEMINI_API_KEY", set: present("GEMINI_API_KEY") },
    { name: "GROQ_API_KEY", set: present("GROQ_API_KEY") },
    { name: "OPENROUTER_API_KEY", set: present("OPENROUTER_API_KEY") },
    { name: "NVIDIA_API_KEY", set: present("NVIDIA_API_KEY") },
    { name: "GITHUB_MODELS_TOKEN", set: present("GITHUB_MODELS_TOKEN") },
    { name: "TAVILY_API_KEY", set: present("TAVILY_API_KEY") },
    { name: "SUPABASE_SERVICE_ROLE_KEY", set: present("SUPABASE_SERVICE_ROLE_KEY") },
    { name: "GEMINI_MODEL", set: present("GEMINI_MODEL"), value: geminiModel() },
    { name: "GEMINI_EMBEDDING_MODEL", set: present("GEMINI_EMBEDDING_MODEL"), value: geminiEmbeddingModel() },
    { name: "GROQ_MODEL", set: present("GROQ_MODEL"), value: groqModel() },
    { name: "GROQ_VISION_MODEL", set: present("GROQ_VISION_MODEL"), value: groqVisionModel() },
  ];

  const rows = await Promise.all([
    timed(t, "gemini", t("diag.row.gemini"), async () => {
      const r = await geminiGenerate(ping);
      return { detail: t("diag.detail.reply", { text: r.text.trim().slice(0, 60) }), model: r.model };
    }),
    timed(t, "gemini-embed", t("diag.row.geminiEmbed"), async () => {
      const v = await geminiEmbed(["test"], "RETRIEVAL_QUERY");
      return { detail: t("diag.detail.vectorDim", { n: v[0].length }), model: geminiEmbeddingModel() };
    }),
    timed(t, "groq", t("diag.row.groq"), async () => {
      const r = await groqGenerate(ping);
      return { detail: t("diag.detail.reply", { text: r.text.trim().slice(0, 60) }), model: r.model };
    }),
    ...[openrouter, nvidia, githubModels].map((p) =>
      timed(t, p.name, t("diag.row.provider", { name: p.name }), async () => {
        if (!p.configured()) return { ok: false, detail: t("diag.detail.noKeyOptional", { env: p.keyEnv }), model: p.model() };
        const r = await p.generate(ping);
        return { detail: t("diag.detail.replyList", { text: r.text.trim().slice(0, 60), list: p.models({ system: "", messages: [] }).join(" -> ") }), model: r.model };
      })
    ),
    timed(t, "tavily", t("diag.row.tavily"), async () => {
      const r = await tavilySearch("Neuron connectivity test", 1);
      return { detail: t("diag.detail.results", { n: r.length }) };
    }),
    timed(t, "fallback", t("diag.row.fallback"), async () => {
      const r = await generateText(ping, { skipBreaker: true });
      if (!r.fellBackFrom) return { detail: t("diag.detail.answeredDirect", { provider: r.provider }), model: r.model };
      const f = r.fellBackFrom;
      return {
        detail: t("diag.detail.fellBack", { provider: r.provider, from: f.provider, status: f.status || "—", message: f.message }).slice(0, 400),
        model: r.model,
        ok: true,
        hint: hintFor(f, t),
        alert: f.provider === "gemini" && f.status === 401,
      };
    }),
    timed(t, "fallback-forced", t("diag.row.fallbackForced"), async () => {
      const skip: LlmProvider[] = ["groq"];
      const r = await generateText(ping, { skipBreaker: true, skip });
      return { detail: t("diag.detail.forcedOk", { provider: r.provider }), model: r.model };
    }),
  ]);

  return { at: new Date().toISOString(), env, rows };
}
