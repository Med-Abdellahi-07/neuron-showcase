import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAiFlag } from "@/lib/ai/access";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { AiQcmRunner } from "@/components/ai-qcm-runner";
import { toAiQ } from "@/lib/ai/qcm-view";
import { ActionForm } from "@/components/action-form";
import { generateQcm } from "@/app/actions/ai-qcm";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function QcmSetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  await requireAiFlag("ai_qcm");
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data: set } = await supabase.from("ai_qcm_sets").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!set) notFound();
  const { data: qs } = await supabase.from("ai_questions").select("*").eq("set_id", id).order("created_at").order("id");
  const lessonIds = [...new Set((qs ?? []).map((q) => q.lesson_id).filter(Boolean))] as string[];
  const label = new Map<string, string>();
  if (lessonIds.length) {
    const { data: ls } = await supabase.from("lessons").select("id, kind, number").in("id", lessonIds);
    for (const l of ls ?? []) label.set(l.id as string, `${String(l.kind).toUpperCase()} ${l.number}`);
  }
  return (
    <div className="space-y-4">
      <Link href="/assistant/qcm" className="text-sm text-accent">← {t("aiq.title")}</Link>
      <AiQcmRunner questions={toAiQ((qs ?? []) as Record<string, unknown>[], label)} />
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">{t("aiq.another")}</summary>
        <p className="mb-3 mt-2 text-xs text-muted">{t("aiq.cost")}</p>
        <ActionForm action={generateQcm} submitLabel={t("aiq.another")} className="space-y-3">
          <input type="hidden" name="subject" value={set.subject_id as string} />
          <input type="hidden" name="kind" value={(set.kind as string | null) ?? ""} />
          {(set.lesson_ids as string[]).map((l) => <input key={l} type="hidden" name="lesson" value={l} />)}
          <input type="hidden" name="count" value={set.question_count as number} />
          <input type="hidden" name="difficulty" value={set.difficulty as string} />
          <input type="hidden" name="lang" value={locale} />
        </ActionForm>
      </details>
    </div>
  );
}
