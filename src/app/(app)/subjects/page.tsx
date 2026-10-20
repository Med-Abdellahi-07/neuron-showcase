import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects, getRemainingSubjects } from "@/lib/data";
import { ProgressRing } from "@/components/progress-ring";
import type { DictKey } from "@/lib/i18n/dictionaries";
import type { Subject } from "@/lib/types";

export default async function SubjectsPage() {
  const userId = await requireUserId();
  const { t } = await getT();
  const supabase = await createClient();

  const [subjects, remaining, { data: lessons }, { data: progress }] = await Promise.all([
    getCurrentSubjects(),
    getRemainingSubjects(),
    supabase.from("lessons").select("id, subject_id").neq("kind", "resume").eq("status", "published"),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", userId),
  ]);
  const studiedSet = new Set((progress ?? []).map((p) => p.lesson_id as string));
  const stats = new Map<string, { total: number; studied: number }>();
  for (const l of lessons ?? []) {
    const s = stats.get(l.subject_id as string) ?? { total: 0, studied: 0 };
    s.total += 1;
    if (studiedSet.has(l.id as string)) s.studied += 1;
    stats.set(l.subject_id as string, s);
  }

  return (
    <div>
      <h1 className="page-title">{t("subjects.title")}</h1>
      {subjects.length === 0 && <p className="text-sm text-muted">{t("subjects.empty")}</p>}
      <SubjectList subjects={subjects} stats={stats} t={t} />
      {remaining.length > 0 && (
        <section className="mt-8 space-y-3" aria-labelledby="rem-h">
          <div>
            <h2 id="rem-h" className="tech text-sm font-semibold">{t("rem.section")}</h2>
            <p className="mt-1 text-xs text-muted">{t("rem.sectionHelp")}</p>
          </div>
          <SubjectList subjects={remaining} stats={stats} t={t} l1 />
        </section>
      )}
    </div>
  );
}

function SubjectList({ subjects, stats, t, l1 = false }: { subjects: Subject[]; stats: Map<string, { total: number; studied: number }>; t: (k: DictKey) => string; l1?: boolean }) {
  return (
      <ul className="space-y-3">
        {subjects.map((s) => {
          const st = stats.get(s.id) ?? { total: 0, studied: 0 };
                    return (
            <li key={s.id}>
              <Link href={`/subjects/${s.code}`} className="card press flex items-center gap-3 transition-colors hover:bg-surface-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-accent tech" dir="ltr">{s.code}</span>
                    <span className="badge">{s.credits} {t("subjects.credits")}</span>
                    {l1 && <span className="badge tech" dir="ltr">L1</span>}
                  </div>
                  <p className="font-medium leading-snug" dir="auto">{s.name}</p>
                </div>
                <ProgressRing done={st.studied} total={st.total} size={56} stroke={6} />
                <ChevronLeft size={18} className="shrink-0 text-muted rtl:rotate-0 ltr:rotate-180" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
  );
}
