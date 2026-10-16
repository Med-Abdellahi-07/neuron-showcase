import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";

export default async function SubjectsPage() {
  const profile = await requireProfile();
  const { t } = await getT();
  const supabase = await createClient();
  const subjects = await getCurrentSubjects();

  const [{ data: lessons }, { data: progress }] = await Promise.all([
    supabase.from("lessons").select("id, subject_id").neq("kind", "resume").eq("status", "published"),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", profile.id),
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
      <ul className="space-y-3">
        {subjects.map((s) => {
          const st = stats.get(s.id) ?? { total: 0, studied: 0 };
          const pct = st.total ? Math.round((st.studied / st.total) * 100) : 0;
          return (
            <li key={s.id}>
              <Link href={`/subjects/${s.code}`} className="card flex items-center gap-3 transition-colors hover:bg-surface-2">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="badge badge-accent tech" dir="ltr">{s.code}</span>
                    <span className="badge">{s.credits} {t("subjects.credits")}</span>
                  </div>
                  <p className="font-medium leading-snug" dir="auto">{s.name}</p>
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="tech text-xs text-muted" dir="ltr">{st.studied}/{st.total}</span>
                  </div>
                </div>
                <ChevronLeft size={18} className="shrink-0 text-muted rtl:rotate-0 ltr:rotate-180" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
