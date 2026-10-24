export type ProviderName = "gemini" | "groq" | "openrouter" | "nvidia" | "github" | "tavily";

/** خطأ من مزوّد خارجي مع رمز HTTP وسبب مفهوم للمدير */
export class AiError extends Error {
  constructor(
    public provider: ProviderName,
    public status: number, // 0 = لم يُضبط المفتاح أو فشل الاتصال
    message: string,
    public reason?: string
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface ErrorInfo {
  provider: ProviderName;
  status: number;
  message: string;
  reason?: string;
}

export const errorInfo = (e: unknown, provider: ProviderName = "gemini"): ErrorInfo =>
  e instanceof AiError
    ? { provider: e.provider, status: e.status, message: e.message, reason: e.reason }
    : { provider, status: 0, message: e instanceof Error ? e.message : String(e) };

/** يقرأ جسم خطأ بصيغة Google أو OpenAI ويحوّله إلى AiError */
export async function errorFromResponse(provider: ProviderName, res: Response): Promise<AiError> {
  let text = "";
  try {
    text = await res.text();
  } catch {
    /* ignore */
  }
  let message = text.slice(0, 300) || res.statusText;
  let reason: string | undefined;
  try {
    const j = JSON.parse(text);
    const err = j.error ?? j;
    message = String(err.message ?? message).slice(0, 300);
    reason =
      err.details?.find?.((d: { reason?: string }) => d.reason)?.reason ?? err.status ?? err.code ?? err.type ?? undefined;
    if (reason !== undefined) reason = String(reason);
  } catch {
    /* not JSON */
  }
  return new AiError(provider, res.status, message, reason);
}
