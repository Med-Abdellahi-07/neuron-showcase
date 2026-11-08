import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/push";
import { after } from "next/server";

export type SpendKind = "chat" | "duel" | "qcm" | "summary" | "errors" | "exam" | "plan" | "flashcards";
export type SpendResult =
  | { ok: true; ledgerId: number }
  | { ok: false; reason: "disabled" | "break" | "busy" | "auth" | "unknown" };

/**
 * Records the request against the hidden cap (no points or counter for the student): the flag, per-minute and daily caps and pressure mode all live in the database.
 * The super admin is alerted on the first overrun of the day.
 */
export async function spendPoints(supabase: SupabaseClient, kind: SpendKind): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("ai_spend", { p_kind: kind });
  if (error || !data) return { ok: false, reason: "unknown" };
  const r = data as { ok: boolean; reason?: string; ledger_id?: number; alert?: boolean };
  if (r.ok) return { ok: true, ledgerId: r.ledger_id ?? 0 };
  if (r.alert) alertAdmins();
  return { ok: false, reason: (r.reason as "disabled" | "break" | "busy" | "auth" | "unknown") ?? "unknown" };
}

/** Notifies super admins that an account exceeded the cap (once per account/day, enforced by the database). Never throws. */
function alertAdmins() {
  try {
    after(async () => {
      try {
        const { data } = await createAdminClient().from("profiles").select("id").eq("role", "admin");
        const ids = (data ?? []).map((x) => x.id as string);
        if (!ids.length) return;
        await sendPush({ userIds: ids }, "announcement", {
          ar: { title: "تنبيه الذكاء الاصطناعي", body: "حساب تجاوز سقف الاستعمال. راجع /admin/ai." },
          fr: { title: "Alerte IA", body: "Un compte a dépassé le plafond d'usage. Voir /admin/ai." },
          en: { title: "AI alert", body: "An account exceeded the usage cap. See /admin/ai." },
          url: "/admin/ai",
          tag: "ai-abuse",
        });
      } catch {
        /* must not stop the work */
      }
    });
  } catch {
    /* Outside the request scope. */
  }
}

/** An operation failed before anything reached the student: remove the request from the ledger (service role only). Never throws. */
export async function refundPoints(ledgerId: number): Promise<void> {
  if (!ledgerId) return;
  try {
    await createAdminClient().rpc("ai_refund", { p_ledger_id: ledgerId });
  } catch {
    /* must not stop the work */
  }
}

export interface AiBalance {
  pressure: number;
  flags: { ai_chat: boolean; ai_summary: boolean; ai_qcm: boolean; ai_duel: boolean; ai_tools: boolean; ai_exam: boolean };
}

export async function getBalance(supabase: SupabaseClient): Promise<AiBalance | null> {
  const { data } = await supabase.rpc("ai_balance");
  return (data as AiBalance | null) ?? null;
}

/** Error code shown by the UIs. */
export const spendErrorCode = (r: Extract<SpendResult, { ok: false }>): "break" | "busy" | "disabled" | "unavailable" =>
  r.reason === "break" || r.reason === "busy" || r.reason === "disabled" ? r.reason : "unavailable";
