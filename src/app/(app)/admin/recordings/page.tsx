import { requireFeature } from "@/lib/spaces";
import { isManagerRole, requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects } from "@/lib/data";
import { deleteRecording } from "@/app/actions/recordings";
import { RecordingForm, type FormLesson } from "@/components/recording-form";
import { ConfirmButton } from "@/components/confirm-button";
import { formatDate } from "@/lib/dates";

type Rec = { id: string; title: string; kind: string; rec_date: string; provider: string; status: string; subject_id: string };

export default async function RecordingsAdminPage() {
  const profile = await requireStaff();
  await requireFeature("recordings");
  const { t, locale } = await getT();
  const supabase = await createClient();
  const subjects = await getAllSubjects();
  const [{ data: cohorts }, { data: lessons }, { data: recs }] = await Promise.all([
    supabase.from("cohorts").select("id, name").eq("id", profile.cohort_id ?? ""),
    supabase.from("lessons").select("id, subject_id, kind, number, title, lesson_date").neq("kind", "resume").order("number"),
    supabase.from("recordings").select("id, title, kind, rec_date, provider, status, subject_id").order("rec_date", { ascending: false }).limit(60),
  ]);
  const code = new Map(subjects.map((s) => [s.id, s.code]));

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("rec.new")}</h2>
        <p className="text-xs text-muted">{t("rec.privacyNote")}</p>
        <RecordingForm
          cohorts={(cohorts ?? []) as { id: string; name: string }[]}
          subjects={subjects.map((s) => ({ id: s.id, code: s.code, name: s.name }))}
          lessons={(lessons ?? []) as FormLesson[]}
          defaultCohort={profile.cohort_id}
        />
      </section>

      <ul className="space-y-2">
        {((recs ?? []) as Rec[]).map((r) => (
          <li key={r.id} className="card space-y-1 !p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="tech text-xs text-accent" dir="ltr">{code.get(r.subject_id)} {r.kind.toUpperCase()}</span>
              <p className="min-w-0 flex-1 font-medium" dir="auto">{r.title}</p>
              <span className={`badge ${r.status === "published" ? "badge-accent" : ""}`}>{t(`status.${r.status as "draft" | "pending" | "published"}`)}</span>
            </div>
            <p className="tech text-xs text-muted">{formatDate(r.rec_date, locale)} · {r.provider}</p>
            {(isManagerRole(profile.role) || r.status !== "published") && (
              <form action={deleteRecording}>
                <input type="hidden" name="id" value={r.id} />
                <ConfirmButton>{t("common.delete")}</ConfirmButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
