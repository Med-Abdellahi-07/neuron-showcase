import Link from "next/link";
import { requireAiFlag } from "@/lib/ai/access";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { AiQcmRunner } from "@/components/ai-qcm-runner";
import { toAiQ } from "@/lib/ai/qcm-view";

/** مراجعة متباعدة لأخطائي في QCM الذكي: الأسئلة المستحقة الآن (تُعاد كأسئلة جديدة غير مُجاب عنها) */
export default async function AiQcmReviewPage() {
  await requireAiFlag("ai_qcm");
  const userId = await requireUserId();
  const { t } = await getT();
  const supabase = await createClient();
  const { data } = await supabase.from("ai_questions").select("*").eq("user_id", userId).eq("mastered", false)
    .lte("due_at", new Date().toISOString()).order("due_at").limit(10);
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({ ...r, selected: null, is_correct: null })); // تُجاب من جديد
  return (
    <div className="space-y-4">
      <Link href="/assistant/qcm" className="text-sm text-accent">← {t("aiq.title")}</Link>
      <h1 className="page-title !mb-1">{t("aiq.dueTitle")}</h1>
      <AiQcmRunner questions={toAiQ(rows, new Map())} />
    </div>
  );
}
