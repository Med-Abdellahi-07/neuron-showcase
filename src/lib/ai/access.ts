import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBalance, type AiBalance } from "./points";

/** رصيد الطالب وأعلام فضائه (طلب واحد لكل صفحة). null = غير مسجَّل. */
export const getAiBalance = cache(async (): Promise<AiBalance | null> => getBalance(await createClient()));

export type AiFlag = keyof AiBalance["flags"];

/** أول صفحة ذكاء اصطناعي مفعّلة لهذا الفضاء، وإلا الرئيسية */
export function aiHome(flags: AiBalance["flags"] | undefined): string {
  if (flags?.ai_chat) return "/assistant";
  if (flags?.ai_summary) return "/assistant/summaries";
  if (flags?.ai_qcm) return "/assistant/qcm";
  return "/";
}

/** للصفحات: العلم مقفول ← إعادة لأول صفحة مفعّلة (لا تُنفَّذ استعلامات الصفحة) */
export async function requireAiFlag(flag: AiFlag): Promise<AiBalance> {
  const b = await getAiBalance();
  if (!b?.flags[flag]) redirect(aiHome(b?.flags));
  return b;
}
