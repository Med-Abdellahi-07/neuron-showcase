import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type SpendKind = "chat" | "qcm" | "summary" | "errors" | "exam" | "plan" | "flashcards";
export type SpendResult =
  | { ok: true; remaining: number; limit: number; ledgerId: number }
  | { ok: false; reason: "disabled" | "quota" | "busy" | "auth" | "unknown"; remaining?: number };

/** يحجز نقاط العملية ذرّياً في قاعدة البيانات (التكلفة والأعلام والحد من الجداول، لا من العميل). */
export async function spendPoints(supabase: SupabaseClient, kind: SpendKind): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("ai_spend", { p_kind: kind });
  if (error || !data) return { ok: false, reason: "unknown" };
  const r = data as { ok: boolean; reason?: string; remaining?: number; limit?: number; ledger_id?: number };
  if (r.ok) return { ok: true, remaining: r.remaining ?? 0, limit: r.limit ?? 0, ledgerId: r.ledger_id ?? 0 };
  return { ok: false, reason: (r.reason as "disabled" | "quota" | "busy" | "auth" | "unknown") ?? "unknown", remaining: r.remaining };
}

/** عملية فشلت قبل أن يصل الطالب شيء: نعيد نقاطه (service role فقط). لا يرمي أبداً. */
export async function refundPoints(ledgerId: number): Promise<void> {
  if (!ledgerId) return;
  try {
    await createAdminClient().rpc("ai_refund", { p_ledger_id: ledgerId });
  } catch {
    /* لا يوقف العمل */
  }
}

export interface AiBalance {
  limit: number;
  used: number;
  remaining: number;
  pressure: number;
  flags: { ai_chat: boolean; ai_summary: boolean; ai_qcm: boolean; ai_duel: boolean; ai_tools: boolean };
}

export async function getBalance(supabase: SupabaseClient): Promise<AiBalance | null> {
  const { data } = await supabase.rpc("ai_balance");
  return (data as AiBalance | null) ?? null;
}

/** رمز الخطأ الذي تعرضه الواجهات */
export const spendErrorCode = (r: Extract<SpendResult, { ok: false }>): "quota" | "busy" | "disabled" | "unavailable" =>
  r.reason === "quota" || r.reason === "busy" || r.reason === "disabled" ? r.reason : "unavailable";
