import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { formatDate, nowMs } from "@/lib/dates";
import { PracticeTabs } from "@/components/practice-tabs";
import { SubmitButton } from "@/components/submit-button";
import { startReview } from "@/app/actions/arena";

interface Item {
  question_id: string;
  stage: number;
  due_at: string;
  mastered: boolean;
  wrong_count: number;
  questions: { statement: string; difficulty: string; subjects: { code: string } | { code: string }[] | null } | { statement: string; difficulty: string; subjects: { code: string } | { code: string }[] | null }[] | null;
}
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function MistakesPage() {
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();

  const { data } = await supabase
    .from("review_queue")
    .select("question_id, stage, due_at, mastered, wrong_count, questions(statement, difficulty, subjects(code))")
    .eq("user_id", userId)
    .order("due_at")
    .limit(200);
  const items = (data ?? []) as unknown as Item[];
  const now = nowMs();
  const active = items.filter((x) => !x.mastered);
  const mastered = items.filter((x) => x.mastered);
  const dueCount = active.filter((x) => new Date(x.due_at).getTime() <= now).length;

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0">{t("practice.title")}</h1>
      <PracticeTabs />

      <section className="card space-y-3" aria-labelledby="rev-h">
        <h2 id="rev-h" className="tech text-sm font-semibold">{t("arena.mistakes.title")}</h2>
        <p className="text-xs text-muted">{t("arena.mistakes.schedule")}</p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="tech text-2xl font-semibold text-accent" dir="ltr">{dueCount}</p>
            <p className="text-xs text-muted">{t(dueCount > 0 ? "arena.review.due" : "arena.review.none")}</p>
          </div>
          {dueCount > 0 && (
            <form action={startReview}>
              <SubmitButton className="btn btn-primary">{t("arena.review.start")}</SubmitButton>
            </form>
          )}
        </div>
      </section>

      {items.length === 0 ? (
        <p className="card text-sm text-muted">{t("arena.mistakes.empty")}</p>
      ) : (
        <>
          <ul className="space-y-2" aria-label={t("arena.mistakes.active")}>
            {active.map((x) => {
              const q = first(x.questions);
              const due = new Date(x.due_at).getTime() <= now;
              return (
                <li key={x.question_id} className="card space-y-2 !p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {first(q?.subjects ?? null) && (
                      <span className="badge badge-accent tech" dir="ltr">{first(q!.subjects)!.code}</span>
                    )}
                    <span className="badge">{t("arena.mistakes.stage")} {x.stage + 1}/4</span>
                    <span className="badge">{t("arena.mistakes.wrongTimes")}: {x.wrong_count}</span>
                    <span className={`badge ${due ? "!text-warn" : ""}`}>
                      {t("arena.mistakes.nextReview")}:{" "}
                      {due ? t("arena.mistakes.today") : formatDate(x.due_at.slice(0, 10), locale)}
                    </span>
                  </div>
                  <p className="line-clamp-3 text-sm" dir="auto">{q?.statement}</p>
                </li>
              );
            })}
          </ul>
          {mastered.length > 0 && (
            <p className="text-sm text-muted">
              {t("arena.mistakes.mastered")}: <span className="tech" dir="ltr">{mastered.length}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}
