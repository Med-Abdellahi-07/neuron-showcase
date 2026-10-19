import { isManagerRole, requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { deleteQuestion, setQuestionExamOnly, setQuestionStatus } from "@/app/actions/content";
import { ConfirmButton } from "@/components/confirm-button";
import { QuestionImporter } from "@/components/question-importer";
import { StatusBadge } from "@/components/status-badge";
import type { Question } from "@/lib/types";

type Row = Question & {
  subjects: { code: string } | { code: string }[] | null;
  lessons: { kind: string; number: number } | { kind: string; number: number }[] | null;
};
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AdminQuestionsPage() {
  const profile = await requireStaff();
  const { t } = await getT();
  const supabase = await createClient();
  const canPublish = isManagerRole(profile.role) || profile.can_publish_direct;

  const { data } = await supabase
    .from("questions")
    .select("id, subject_id, lesson_id, type, difficulty, statement, status, exam_only, subjects(code), lessons(kind, number)")
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-8">
      <div>
        <h2 className="tech mb-3 text-sm font-semibold">{t("q.import")}</h2>
        <QuestionImporter />
      </div>

      <section className="space-y-3" aria-labelledby="recent-h">
        <h2 id="recent-h" className="tech text-sm font-semibold">{t("q.recent")}</h2>
        <ul className="space-y-2">
          {rows.map((q) => {
            const subject = first(q.subjects);
            const lesson = first(q.lessons);
            return (
              <li key={q.id} className="card space-y-2 !p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-accent tech" dir="ltr">{subject?.code}</span>
                  {lesson && <span className="badge tech" dir="ltr">{(lesson.kind ?? "").toUpperCase()} {lesson.number}</span>}
                  <span className="badge">{t(`qtype.${q.type}`)}</span>
                  <span className="badge">{t(`diff.${q.difficulty}`)}</span>
                  <StatusBadge status={q.status} />
                  {q.exam_only && <span className="badge-urgent">{t("qcm.examOnly")}</span>}
                </div>
                <p className="line-clamp-2 text-sm" dir="auto">{q.statement}</p>
                <div className="flex gap-2">
                  {q.status !== "published" && (
                    <form action={setQuestionStatus}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="status" value="published" />
                      <button className="btn btn-sm btn-primary">{canPublish ? t("action.publish") : t("action.submit")}</button>
                    </form>
                  )}
                  {q.status === "published" && canPublish && (
                    <form action={setQuestionStatus}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="status" value="draft" />
                      <button className="btn btn-sm">{t("action.unpublish")}</button>
                    </form>
                  )}
                  {isManagerRole(profile.role) && q.type === "mcq" && (
                    <form action={setQuestionExamOnly}>
                      <input type="hidden" name="id" value={q.id} />
                      <input type="hidden" name="value" value={q.exam_only ? "0" : "1"} />
                      <button className="btn btn-sm">{q.exam_only ? t("qcm.examOnlyUnset") : t("qcm.examOnlySet")}</button>
                    </form>
                  )}
                  <form action={deleteQuestion}>
                    <input type="hidden" name="id" value={q.id} />
                    <ConfirmButton>{t("common.delete")}</ConfirmButton>
                  </form>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
