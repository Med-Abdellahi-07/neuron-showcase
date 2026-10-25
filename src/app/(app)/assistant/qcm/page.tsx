import Link from "next/link";
import { Trash2 } from "lucide-react";
import { requireAiFlag } from "@/lib/ai/access";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { QcmForm, type PickLesson } from "@/components/ai-forms";
import { deleteQcmSet } from "@/app/actions/ai-qcm";
import { ConfirmButton } from "@/components/confirm-button";

export const maxDuration = 60;

export default async function AiQcmPage() {
  await requireAiFlag("ai_qcm");
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [subjects, lessonRes, setsRes, dueRes] = await Promise.all([
    getCurrentSubjects(),
    supabase.from("lessons").select("id, subject_id, kind, number, title").eq("status", "published").order("number").limit(600),
    supabase.from("ai_qcm_sets").select("id, subject_id, kind, question_count, difficulty, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(40),
    supabase.from("ai_questions").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("mastered", false).lte("due_at", new Date().toISOString()),
  ]);
  const byId = new Map(subjects.map((s) => [s.id, s.code]));
  const ids = new Set(subjects.map((s) => s.id));
  const lessons = ((lessonRes.data ?? []) as PickLesson[]).filter((l) => ids.has(l.subject_id));
  const sets = (setsRes.data ?? []) as { id: string; subject_id: string; kind: string | null; question_count: number; difficulty: string; created_at: string }[];
  const due = dueRes.count ?? 0;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title !mb-1">{t("aiq.title")}</h1>
        <p className="text-sm text-muted">{t("aiq.intro")}</p>
      </header>
      <QcmForm subjects={subjects.map((s) => ({ id: s.id, code: s.code, name: s.name }))} lessons={lessons} defaultLang={locale} />
      <section className="card flex items-center justify-between gap-2" aria-labelledby="due-h">
        <div>
          <h2 id="due-h" className="text-sm font-semibold">{t("aiq.dueTitle")}</h2>
          <p className="text-xs text-muted">{due > 0 ? t("aiq.dueCount").replace("{n}", String(due)) : t("aiq.dueEmpty")}</p>
        </div>
        {due > 0 && <Link href="/assistant/qcm/review" className="btn btn-sm btn-primary">{t("aiq.review")}</Link>}
      </section>
      <section className="space-y-2" aria-labelledby="sets-h">
        <h2 id="sets-h" className="tech text-sm font-semibold text-muted">{t("aiq.mine")}</h2>
        {sets.length === 0 ? <p className="text-sm text-muted">{t("aiq.empty")}</p> : (
          <ul className="space-y-2">
            {sets.map((s) => (
              <li key={s.id} className="card flex items-center gap-2">
                <Link href={`/assistant/qcm/${s.id}`} className="min-w-0 flex-1">
                  <p className="tech font-medium" dir="ltr">{byId.get(s.subject_id) ?? "—"}{s.kind ? ` · ${s.kind.toUpperCase()}` : ""} · {s.question_count} Q</p>
                  <p className="tech text-xs text-muted">{t(`diff.${s.difficulty as "easy"}`)} · {formatDate(s.created_at.slice(0, 10), locale)}</p>
                </Link>
                <form action={deleteQcmSet}>
                  <input type="hidden" name="id" value={s.id} />
                  <ConfirmButton><Trash2 size={14} aria-hidden /><span className="sr-only">{t("common.delete")}</span></ConfirmButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
