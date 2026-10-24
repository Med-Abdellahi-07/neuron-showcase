import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { resolveAiReport } from "@/app/actions/ai-qcm";
import { Rich } from "@/components/rich";

interface Rep { id: string; subject_code: string; statement: string; options: string[]; correct_index: number; explanation: string; page: number | null; note: string | null; status: string }

/** أسئلة QCM المولّدة التي أبلغ الطلاب عن خطئها (لمواد فضاء المشرف فقط، بلا هوية المبلِّغ) */
export async function ReportedAiQuestions() {
  const { t } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reported_ai_questions");
  if (error) return null;
  const rows = ((data ?? []) as Rep[]).filter((r) => r.status === "open");
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="rep-h">
      <h2 id="rep-h" className="tech text-sm font-semibold">{t("aiq.reports")} <span className="text-muted">({rows.length})</span></h2>
      <p className="text-xs text-muted">{t("aiq.reportsHelp")}</p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="card space-y-2 text-sm">
            <p className="tech text-xs text-muted" dir="ltr">{r.subject_code}{r.page ? ` · p. ${r.page}` : ""}</p>
            <Rich>{r.statement}</Rich>
            <ol className="list-[upper-alpha] space-y-0.5 ps-5" dir="auto">
              {r.options.map((o, i) => <li key={i} className={i === r.correct_index ? "font-semibold text-success" : ""}>{o}</li>)}
            </ol>
            {r.note && <p className="rounded-lg bg-surface-2 p-2 text-xs" dir="auto">“{r.note}”</p>}
            <form action={resolveAiReport}>
              <input type="hidden" name="id" value={r.id} />
              <button className="btn btn-sm" type="submit">{t("aiq.resolve")}</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
}
