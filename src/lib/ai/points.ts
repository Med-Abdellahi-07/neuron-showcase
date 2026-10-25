import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPush } from "@/lib/push";
import { after } from "next/server";

export type SpendKind = "chat" | "duel" | "qcm" | "summary" | "errors" | "exam" | "plan" | "flashcards";
export type SpendResult =
  | { ok: true; ledgerId: number }
  | { ok: false; reason: "disabled" | "break" | "busy" | "auth" | "unknown" };

/**
 * يسجّل الطلب ضد السقف الخفي (لا نقاط ولا عدّاد للطالب): العلم، وسقف الدقيقة واليوم ووضع الضغط، كلها في قاعدة البيانات.
 * عند أول تجاوز في اليوم يُنبَّه المشرف العام.
 */
export async function spendPoints(supabase: SupabaseClient, kind: SpendKind): Promise<SpendResult> {
  const { data, error } = await supabase.rpc("ai_spend", { p_kind: kind });
  if (error || !data) return { ok: false, reason: "unknown" };
  const r = data as { ok: boolean; reason?: string; ledger_id?: number; alert?: boolean };
  if (r.ok) return { ok: true, ledgerId: r.ledger_id ?? 0 };
  if (r.alert) alertAdmins();
  return { ok: false, reason: (r.reason as "disabled" | "break" | "busy" | "auth" | "unknown") ?? "unknown" };
}

/** إشعار للمشرفين العامين بأن حساباً تجاوز السقف (مرة واحدة لكل حساب/يوم من قاعدة البيانات). لا يرمي. */
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
        /* لا يوقف العمل */
      }
    });
  } catch {
    /* خارج نطاق الطلب */
  }
}

/** عملية فشلت قبل أن يصل الطالب شيء: نشطب الطلب من السجل (service role فقط). لا يرمي أبداً. */
export async function refundPoints(ledgerId: number): Promise<void> {
  if (!ledgerId) return;
  try {
    await createAdminClient().rpc("ai_refund", { p_ledger_id: ledgerId });
  } catch {
    /* لا يوقف العمل */
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

/** رمز الخطأ الذي تعرضه الواجهات */
export const spendErrorCode = (r: Extract<SpendResult, { ok: false }>): "break" | "busy" | "disabled" | "unavailable" =>
  r.reason === "break" || r.reason === "busy" || r.reason === "disabled" ? r.reason : "unavailable";
