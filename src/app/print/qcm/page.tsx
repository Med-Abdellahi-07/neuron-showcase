import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { INTL_TAG, isRtl } from "@/lib/i18n/dictionaries";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects } from "@/lib/data";
import { appTimeZone, todayISO } from "@/lib/dates";
import { chunk, optionLetter, parseQcmParams, scopeLabel } from "@/lib/qcm";
import { PrintMd } from "@/components/print-md";
import { PrintControls } from "@/components/print-controls";

export const dynamic = "force-dynamic";

interface ExportQuestion {
  n: number;
  statement: string;
  options: string[];
  correct: number;
  explanation: string | null;
}
interface ExportResult {
  subject_id: string | null;
  lesson: { kind: string; number: number; title: string } | null;
  remaining: number;
  questions: ExportQuestion[];
}

/**
 * صفحة طباعة QCM (A4، أبيض وأسود، بلا تنقل). جلب الأسئلة والأجوبة هنا على الخادم فقط عبر الدالة
 * qcm_export (security definer: تستثني exam_only، وتحدّ 10 تنزيلات/24 ساعة). لا شيء يُجلب من المتصفح.
 */
export default async function PrintQcmPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserId();
  const { t, locale } = await getT();
  const p = parseQcmParams(await searchParams);
  const subjects = await getAllSubjects();
  const subject = p.subjectCode ? subjects.find((s) => s.code === p.subjectCode) : undefined;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("qcm_export", {
    p_subject: subject?.id ?? null,
    p_lesson: p.lesson,
    p_from: p.from,
    p_to: p.to,
    p_difficulty: p.difficulty,
    p_count: p.count,
    p_shuffle: p.shuffle,
    p_explain: p.explain,
  });

  const backHref = p.lesson ? `/practice/qcm?lesson=${p.lesson}` : "/practice/qcm";

  if (error || !data) {
    const msg = error?.message ?? "";
    const text = msg.includes("download_limit") ? t("qcm.err.limit") : msg.includes("no_questions") ? t("qcm.err.none") : t("qcm.err.generic");
    const known = msg.includes("download_limit") || msg.includes("no_questions");
    if (!known) console.error("qcm_export failed:", error?.code, msg);
    // رمز تقني قصير (مثل PGRST202 = الدالة غير موجودة، أي لم يُشغَّل 0016) ليسهل تشخيص السبب دون كشف تفاصيل
    const code = !known && error?.code ? String(error.code).slice(0, 12) : null;
    return (
      <main className="qcm-root">
        <div className="qcm-sheet">
          <p role="alert" className="rounded-lg border border-neutral-400 p-4 text-sm">
            {text}
            {code && <span dir="ltr" className="mt-2 block text-xs opacity-70">code: {code}</span>}
          </p>
          <Link href={backHref} className="mt-4 inline-block text-sm underline">{t("qcm.close")}</Link>
        </div>
      </main>
    );
  }

  const r = data as unknown as ExportResult;
  const subj = subjects.find((s) => s.id === r.subject_id);
  const subjectName = subj ? `${subj.code} — ${subj.name}` : t("qcm.allSubjects");
  const scope = scopeLabel(
    { lessonLabel: r.lesson ? `${r.lesson.kind.toUpperCase()} ${r.lesson.number}` : null, from: p.from, to: p.to },
    { all: t("qcm.allLessons"), lessons: t("qcm.lessons"), lesson: t("qcm.lesson") }
  );
  const date = new Intl.DateTimeFormat(INTL_TAG[locale], { day: "numeric", month: "long", year: "numeric", timeZone: appTimeZone() }).format(new Date());
  const withExplain = r.questions.filter((q) => q.explanation);
  const title = `Neuron QCM ${subj?.code ?? ""} ${todayISO()}`.replace(/\s+/g, " ").trim();

  return (
    <main className="qcm-root">
      <div className="qcm-sheet">
        <PrintControls title={title} printLabel={t("qcm.print")} backLabel={t("qcm.close")} howto={t("qcm.howto")} backHref={backHref} />

        <header className="qcm-head">
          <p dir={isRtl(locale) ? "rtl" : "ltr"}>
            <strong>Neuron</strong> · <span dir="ltr">{subjectName}</span> · {scope} · {date}
          </p>
        </header>

        {/* محتوى الأسئلة بالفرنسية: يُعرض LTR دائماً حتى في واجهة عربية */}
        <section aria-label={t("qcm.questions")} dir="ltr">
          {r.questions.map((q) => (
            <article key={q.n} className="qcm-q">
              <div className="qcm-q-head">
                <span className="qcm-num">{q.n}.</span>
                <div className="qcm-stmt"><PrintMd>{q.statement}</PrintMd></div>
                <span className="qcm-box" aria-label={t("qcm.mark")} />
              </div>
              <ul className="qcm-opts">
                {q.options.map((o, i) => (
                  <li key={i}>
                    <span className="qcm-letter" dir="ltr">{optionLetter(i)}.</span>
                    <PrintMd inline>{o}</PrintMd>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="qcm-answers" aria-label={t("qcm.answers")}>
          <h2>{t("qcm.answers")} — <span dir="ltr">{subjectName}</span></h2>
          <div className="qcm-tables">
            {chunk(r.questions).map((rows, i) => (
              <table key={i}>
                <thead>
                  <tr>
                    <th scope="col">{t("qcm.number")}</th>
                    <th scope="col">{t("qcm.answer")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => (
                    <tr key={q.n}>
                      <td dir="ltr">{q.n}</td>
                      <td dir="ltr">{optionLetter(q.correct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>

          {p.explain && withExplain.length > 0 && (
            <div className="qcm-expl" dir="ltr">
              <h3 dir={isRtl(locale) ? "rtl" : "ltr"}>{t("qcm.explanations")}</h3>
              {withExplain.map((q) => (
                <div key={q.n} className="qcm-expl-item">
                  <span className="qcm-expl-n" dir="ltr">{q.n} → {optionLetter(q.correct)}</span>
                  <PrintMd>{q.explanation as string}</PrintMd>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
