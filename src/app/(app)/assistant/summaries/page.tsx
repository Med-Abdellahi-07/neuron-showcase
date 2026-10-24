import Link from "next/link";
import { Trash2 } from "lucide-react";
import { requireAiFlag } from "@/lib/ai/access";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { SummaryForm, type PickLesson } from "@/components/ai-forms";
import { deleteSummary } from "@/app/actions/ai-summary";
import { ConfirmButton } from "@/components/confirm-button";

export default async function SummariesPage() {
  await requireAiFlag("ai_summary");
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [subjects, lessonRes, listRes] = await Promise.all([
    getCurrentSubjects(),
    supabase.from("lessons").select("id, subject_id, kind, number, title").eq("status", "published").order("number").limit(600),
    supabase.from("ai_summaries").select("id, title, kind, lang, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(60),
  ]);
  const ids = new Set(subjects.map((s) => s.id));
  const lessons = ((lessonRes.data ?? []) as PickLesson[]).filter((l) => ids.has(l.subject_id));
  const list = (listRes.data ?? []) as { id: string; title: string; kind: string; lang: string; created_at: string }[];

  return (
    <div className="space-y-5">
      <header>
        <h1 className="page-title !mb-1">{t("sum.title")}</h1>
        <p className="text-sm text-muted">{t("sum.intro")}</p>
      </header>
      <SummaryForm subjects={subjects.map((s) => ({ id: s.id, code: s.code, name: s.name }))} lessons={lessons} defaultLang={locale} />
      <section className="space-y-2" aria-labelledby="sum-list">
        <h2 id="sum-list" className="tech text-sm font-semibold text-muted">{t("sum.mine")}</h2>
        {list.length === 0 ? <p className="text-sm text-muted">{t("sum.empty")}</p> : (
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.id} className="card flex items-center gap-2">
                <Link href={`/assistant/summaries/${x.id}`} className="min-w-0 flex-1">
                  <p className="truncate font-medium" dir="auto">{x.title}</p>
                  <p className="tech text-xs text-muted">{t(`sum.kind.${x.kind as "short"}`)} · {x.lang.toUpperCase()} · {formatDate(x.created_at.slice(0, 10), locale)}</p>
                </Link>
                <form action={deleteSummary}>
                  <input type="hidden" name="id" value={x.id} />
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
