import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getBalance, type AiBalance } from "./points";

/** The student's balance and their space's flags (one request per page). null = not signed in. */
export const getAiBalance = cache(async (): Promise<AiBalance | null> => getBalance(await createClient()));

export type AiFlag = keyof AiBalance["flags"];

/** The first AI page enabled for this space, otherwise Home. */
export function aiHome(flags: AiBalance["flags"] | undefined): string {
  if (flags?.ai_chat) return "/assistant";
  if (flags?.ai_summary) return "/assistant/summaries";
  if (flags?.ai_qcm) return "/assistant/qcm";
  return "/";
}

/** For pages: flag is off -> redirect to the first enabled page (the page's queries do not run). */
export async function requireAiFlag(flag: AiFlag): Promise<AiBalance> {
  const b = await getAiBalance();
  if (!b?.flags[flag]) redirect(aiHome(b?.flags));
  return b;
}
