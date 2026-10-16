import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { QuizRunner, type QuizQuestion } from "@/components/quiz-runner";
import { SubmitButton } from "@/components/submit-button";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default async function PracticePage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireProfile();
  const sp = await searchParams;
  const { t } = await getT();
  const supabase = await createClient();
  const subjects = await getCurrentSubjects();

  const subjectCode = one(sp.subject);
  const lessonId = UUID_RE.test(one(sp.lesson)) ? one(sp.lesson) : "";
  const from = parseInt(one(sp.from), 10);
  const to = parseInt(one(sp.to), 10);
  const difficulty = ["easy", "medium", "hard"].includes(one(sp.difficulty)) ? one(sp.difficulty) : "";
  const count = Math.min(Math.max(parseInt(one(sp.count), 10) || 10, 1), 50);
  const started = one(sp.start) === "1";

  let lessonTitle = "";
  if (lessonId) {
    const { data } = await supabase.from("lessons").select("title, number, kind").eq("id", lessonId).maybeSingle();
    if (data) lessonTitle = `${String(data.kind).toUpperCase()} ${data.number} — ${data.title}`;
  }

  let questions: QuizQuestion[] = [];
  if (started) {
    let query = supabase
      .from("questions")
      .select("id, type, difficulty, statement, options, correct_index, model_answer, explanation, subject_id, lessons(number)")
      .eq("status", "published")
      .limit(500);
    if (lessonId) query = query.eq("lesson_id", lessonId);
    else if (subjectCode) {
      const subject = subjects.find((s) => s.code === subjectCode);
      if (subject) query = query.eq("subject_id", subject.id);
    }
    if (difficulty) query = query.eq("difficulty", difficulty);
    const { data } = await query;

    type Row = QuizQuestion & { lessons: { number: number } | { number: number }[] | null };
    let rows = (data ?? []) as unknown as Row[];
    if (!Number.isNaN(from) || !Number.isNaN(to)) {
      rows = rows.filter((r) => {
        const lesson = Array.isArray(r.lessons) ? r.lessons[0] : r.lessons;
        if (!lesson) return false;
        return (Number.isNaN(from) || lesson.number >= from) && (Number.isNaN(to) || lesson.number <= to);
      });
    }
    questions = shuffle(rows).slice(0, count).map((r) => ({
      id: r.id,
      type: r.type,
      difficulty: r.difficulty,
      statement: r.statement,
      options: r.options,
      correct_index: r.correct_index,
      model_answer: r.model_answer,
      explanation: r.explanation,
    }));
  }

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0">{t("practice.title")}</h1>

      {started && questions.length > 0 ? (
        <>
          <p className="text-xs text-muted">{t("practice.free")}</p>
          <QuizRunner questions={questions} />
          <Link href="/practice" className="text-sm text-accent hover:underline">{t("common.back")}</Link>
        </>
      ) : (
        <>
          {started && <p className="card text-sm text-warn">{t("practice.none")}</p>}
          <form method="get" className="card space-y-4">
            <input type="hidden" name="start" value="1" />
            {lessonId && (
              <div className="flex items-center justify-between gap-2 rounded-[var(--radius)] bg-accent-soft p-3 text-sm">
                <span className="min-w-0 truncate" dir="auto">{t("practice.lesson")}: {lessonTitle}</span>
                <input type="hidden" name="lesson" value={lessonId} />
                <Link href="/practice" className="shrink-0 text-xs text-accent hover:underline">✕</Link>
              </div>
            )}
            {!lessonId && (
              <>
                <div>
                  <label className="label" htmlFor="subject">{t("practice.subject")}</label>
                  <select id="subject" name="subject" className="input" defaultValue={subjectCode} dir="auto">
                    <option value="">{t("common.all")}</option>
                    {subjects.map((s) => (
                      <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="label" htmlFor="from">{t("practice.from")}</label>
                    <input id="from" name="from" type="number" min={1} className="input" dir="ltr" defaultValue={Number.isNaN(from) ? "" : from} />
                  </div>
                  <div>
                    <label className="label" htmlFor="to">{t("practice.to")}</label>
                    <input id="to" name="to" type="number" min={1} className="input" dir="ltr" defaultValue={Number.isNaN(to) ? "" : to} />
                  </div>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="difficulty">{t("practice.difficulty")}</label>
                <select id="difficulty" name="difficulty" className="input" defaultValue={difficulty}>
                  <option value="">{t("diff.mix")}</option>
                  <option value="easy">{t("diff.easy")}</option>
                  <option value="medium">{t("diff.medium")}</option>
                  <option value="hard">{t("diff.hard")}</option>
                </select>
              </div>
              <div>
                <label className="label" htmlFor="count">{t("practice.count")}</label>
                <select id="count" name="count" className="input" defaultValue={String(count)} dir="ltr">
                  {[5, 10, 20, 30, 50].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            </div>
            <SubmitButton className="btn btn-primary w-full">{t("practice.start")}</SubmitButton>
          </form>
          <p className="text-xs text-muted">{t("practice.comingArena")}</p>
        </>
      )}
    </div>
  );
}
