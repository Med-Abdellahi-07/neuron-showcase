import Link from "next/link";
import { notFound } from "next/navigation";
import { Video } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjectByCode } from "@/lib/data";
import { LESSON_KINDS } from "@/lib/constants";

export default async function SubjectPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUserId();
  const { code } = await params;
  const { t } = await getT();
  const subject = await getSubjectByCode(decodeURIComponent(code));
  if (!subject) notFound();

  const supabase = await createClient();
  const { data: lessons } = await supabase
    .from("lessons")
    .select("kind")
    .eq("subject_id", subject.id)
    .eq("status", "published");
  const counts = new Map<string, number>();
  for (const l of lessons ?? []) counts.set(l.kind as string, (counts.get(l.kind as string) ?? 0) + 1);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/subjects" className="text-sm text-accent hover:underline">{t("nav.subjects")}</Link>
        <h1 className="page-title !mb-0 mt-1" dir="auto">{subject.name}</h1>
        <p className="tech text-sm text-muted" dir="ltr">{subject.code}</p>
      </div>

      <ul className="grid grid-cols-2 gap-3">
        {LESSON_KINDS.map((k) => (
          <li key={k}>
            <Link href={`/subjects/${subject.code}/${k}`} className="card block text-center transition-colors hover:bg-surface-2">
              <p className="tech text-lg font-semibold">{t(`kind.${k}`)}</p>
              <p className="mt-1 text-xs text-muted">{counts.get(k) ?? 0} {t("common.lessons")}</p>
            </Link>
          </li>
        ))}
      </ul>

      <section className="card flex items-start gap-3 opacity-70" aria-labelledby="rec-h">
        <Video size={18} className="mt-0.5 text-muted" aria-hidden />
        <div>
          <h2 id="rec-h" className="text-sm font-semibold">{t("subjects.recordings")}</h2>
          <p className="text-xs text-muted">{t("subjects.recordingsSoon")}</p>
        </div>
      </section>
    </div>
  );
}
