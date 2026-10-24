export type LlmName = "groq" | "openrouter" | "nvidia" | "github" | "gemini";

const DEFAULT_LIMITS: Record<LlmName, number> = { groq: 1000, openrouter: 200, nvidia: 1000, github: 150, gemini: 250 };

export const dailyLimit = (p: LlmName): number => {
  const v = Number(process.env[`AI_LIMIT_${p.toUpperCase()}_DAILY`]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_LIMITS[p];
};

/** نسبة الاستهلاك → معامل الحصة */
export function pressureFor(ratio: number): number {
  if (ratio >= 0.9) return 0.3;
  if (ratio >= 0.8) return 0.5;
  if (ratio >= 0.65) return 0.75;
  return 1;
}

