import Link from "next/link";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjectByCode } from "@/lib/data";
import { LESSON_KINDS } from "@/lib/constants";
import { formatDate } from "@/lib/dates";
import type { Lesson, LessonKind } from "@/lib/types";

export default async function KindPage({ params }: { params: Promise<{ code: string; kind: string }> }) {
  const profile = await requireProfile();
  const { code, kind } = await params;
  if (!LESSON_KINDS.includes(kind as LessonKind)) notFound();
  const { t, locale } = await getT();
  const subject = await getSubjectByCode(decodeURIComponent(code));
  if (!subject) notFound();

  const supabase = await createClient();
  const [{ data: lessons }, { data: progress }] = await Promise.all([
    supabase
      .from("lessons")
      .select("id, number, title, lesson_date")
      .eq("subject_id", subject.id)
      .eq("kind", kind)
      .eq("status", "published")
      .order("number"),
    supabase.from("lesson_progress").select("lesson_id").eq("user_id", profile.id),
  ]);
  const studied = new Set((progress ?? []).map((p) => p.lesson_id as string));
  const rows = (lessons ?? []) as Pick<Lesson, "id" | "number" | "title" | "lesson_date">[];

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/subjects/${subject.code}`} className="text-sm text-accent hover:underline" dir="auto">{subject.name}</Link>
        <h1 className="page-title !mb-0 mt-1">{t(`kind.${kind as LessonKind}`)}</h1>
      </div>
      {rows.length === 0 && <p className="text-sm text-muted">{t("subjects.noLessons")}</p>}
      <ul className="space-y-2">
        {rows.map((l) => (
          <li key={l.id}>
            <Link href={`/lessons/${l.id}`} className="card flex items-center gap-3 transition-colors hover:bg-surface-2">
              <span className="tech flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent" dir="ltr">
                {l.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium" dir="auto">{l.title}</p>
                {l.lesson_date && <p className="tech text-xs text-muted">{formatDate(l.lesson_date, locale)}</p>}
              </div>
              {studied.has(l.id) && <Check size={18} className="text-success" aria-label={t("lesson.studiedDone")} />}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
