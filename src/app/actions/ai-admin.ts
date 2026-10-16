"use server";

import { requireAdmin } from "@/lib/auth";
import { runDiagnostics, type DiagReport } from "@/lib/ai/diagnostics";

/** اختبار المزوّدين: للمدير فقط. لا يُرجع قيم المفاتيح أبداً. */
export async function runAiDiagnostics(): Promise<DiagReport> {
  await requireAdmin();
  return runDiagnostics();
}
