import { githubModels, nvidia, openrouter } from "./compat";
import { AiError, errorInfo, type ErrorInfo, type ProviderName } from "./errors";
import { GENERAL_CHAIN, PERSONAL_CHAIN } from "./chain-order";
import { geminiGenerate, geminiModel, geminiStream, type GenOpts } from "./gemini";
import { groqGenerate, groqModel, groqStream, groqVisionModel } from "./groq";

export type { ChatMsg, GenOpts } from "./gemini";
export { AiError, errorInfo, type ErrorInfo } from "./errors";

export type { LlmProvider } from "./chain-order";
import type { LlmProvider } from "./chain-order";

export interface Used {
  provider: LlmProvider;
  model: string;
  /** If a provider failed before this one succeeded: the first failed provider's reason. */
  fellBackFrom?: ErrorInfo;
}

interface Entry {
  name: LlmProvider;
  configured: () => boolean;
  /** Accepts images? */
  vision: boolean;
  model: (o: GenOpts) => string;
  generate: (o: GenOpts) => Promise<{ text: string; model: string }>;
  stream: (o: GenOpts) => AsyncGenerator<string>;
}

const compat = (p: typeof openrouter, vision = false): Entry => ({
  name: p.name as LlmProvider,
  configured: p.configured,
  vision,
  model: (o) => p.model(o),
  generate: p.generate,
  stream: p.stream,
});

const REGISTRY: Record<LlmProvider, Entry> = {
  groq: {
    name: "groq",
    configured: () => !!process.env.GROQ_API_KEY?.trim(),
    vision: true,
    model: (o) => (o.messages.some((m) => m.images?.length) ? groqVisionModel() : groqModel()),
    generate: groqGenerate,
    stream: groqStream,
  },
  openrouter: compat(openrouter, true),
  nvidia: compat(nvidia),
  github: compat(githubModels),
  gemini: {
    name: "gemini",
    configured: () => !!process.env.GEMINI_API_KEY?.trim(),
    vision: true,
    model: () => geminiModel(),
    generate: geminiGenerate,
    stream: geminiStream,
  },
};

export function chainFor(o: GenOpts, skip: LlmProvider[] = []): Entry[] {
  const hasImages = o.messages.some((m) => m.images?.length);
  return (o.personal === false ? GENERAL_CHAIN : PERSONAL_CHAIN)
    .filter((n) => !skip.includes(n))
    .map((n) => REGISTRY[n])
    .filter((e) => e.configured() && (!hasImages || e.vision));
}

/** Names of the configured providers (for the admin panel). */
export const configuredProviders = (): LlmProvider[] =>
  (Object.keys(REGISTRY) as LlmProvider[]).filter((n) => REGISTRY[n].configured());

/**
 * A key/model failure (401/403/404) does not heal within seconds, and neither does a 429 once the quota is exhausted: avoid paying a failed attempt's latency
 * on every message with a short in-memory circuit breaker per provider. Other transient errors are always retried.
 */
const blocked = new Map<LlmProvider, { until: number; info: ErrorInfo }>();
const isBlocked = (n: LlmProvider) => {
  const b = blocked.get(n);
  return b && Date.now() < b.until ? b.info : null;
};
function noteProviderFailure(n: LlmProvider, e: unknown): ErrorInfo {
  const info = errorInfo(e, n);
  noteFailure(info);
  if ([401, 403, 404].includes(info.status)) blocked.set(n, { until: Date.now() + 60_000, info });
  else if (info.status === 429) blocked.set(n, { until: Date.now() + 20_000, info });
  return info;
}
const noteProviderOk = (n: LlmProvider) => blocked.delete(n);

/** Provider failures since the last flush; the request path saves them to the database so they show up for the admin. */
const failures: ErrorInfo[] = [];
const noteFailure = (i: ErrorInfo) => {
  if (failures.length < 20) failures.push(i);
};
const uses: ProviderName[] = [];
export const noteUse = (p: ProviderName) => {
  if (uses.length < 200) uses.push(p);
};
export const drainUses = () => uses.splice(0, uses.length);
export const drainFailures = (): ErrorInfo[] => failures.splice(0, failures.length);

function allFailed(errs: ErrorInfo[]): AiError {
  const last = errs[errs.length - 1];
  return new AiError(last.provider, last.status, errs.map((e) => `${e.provider}: ${e.status} ${e.message}`).join(" | ").slice(0, 600), last.reason);
}
const noProviders = () => new AiError("groq", 0, "لا يوجد مزوّد ذكاء اصطناعي مضبوط (GROQ_API_KEY …)");

export interface GenControl {
  /** Bypasses the circuit breaker (full test). */
  skipBreaker?: boolean;
  /** Providers to exclude (automatic failover test). */
  skip?: LlmProvider[];
}

/** Full text generation: tries providers in order and fails over automatically on any failure (429 or otherwise). */
export async function generateText(o: GenOpts, opts: GenControl = {}): Promise<{ text: string } & Used> {
  const errs: ErrorInfo[] = [];
  for (const e of chainFor(o, opts.skip)) {
    const b = !opts.skipBreaker && isBlocked(e.name);
    if (b) {
      errs.push(b);
      continue;
    }
    try {
      const r = await e.generate(o);
      noteProviderOk(e.name);
      noteUse(e.name);
      return { text: r.text, provider: e.name, model: r.model, fellBackFrom: errs[0] };
    } catch (err) {
      errs.push(noteProviderFailure(e.name, err));
    }
  }
  if (!errs.length) throw noProviders();
  throw allFailed(errs);
}

export async function generateJson<T>(o: GenOpts, opts: GenControl = {}): Promise<{ data: T } & Used> {
  const r = await generateText({ ...o, json: true }, opts);
  const cleaned = r.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return { data: JSON.parse(cleaned) as T, provider: r.provider, model: r.model, fellBackFrom: r.fellBackFrom };
  } catch {
    throw new AiError(r.provider, 502, "الرد ليس JSON صالحاً");
  }
}

export type StreamEvent = { type: "meta"; used: Used } | { type: "delta"; text: string };

/**
 * Streams the reply. If a provider fails before the first chunk we move to the next. If it drops after the reply started we throw
 * (no repeating text to the student).
 */
export async function* streamChat(o: GenOpts): AsyncGenerator<StreamEvent> {
  const errs: ErrorInfo[] = [];
  for (const e of chainFor(o)) {
    const b = isBlocked(e.name);
    if (b) {
      errs.push(b);
      continue;
    }
    let started = false;
    try {
      for await (const t of e.stream(o)) {
        if (!started) {
          started = true;
          noteProviderOk(e.name);
          noteUse(e.name);
          yield { type: "meta", used: { provider: e.name, model: e.model(o), fellBackFrom: errs[0] } };
        }
        yield { type: "delta", text: t };
      }
      return;
    } catch (err) {
      if (started) {
        noteProviderFailure(e.name, err);
        throw err;
      }
      errs.push(noteProviderFailure(e.name, err));
    }
  }
  if (!errs.length) throw noProviders();
  throw allFailed(errs);
}
