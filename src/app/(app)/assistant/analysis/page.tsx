import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { Rich } from "@/components/rich";
import { AnalysisRefresh } from "@/components/analysis-refresh";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Stats {
  answered: number;
  correct: number;
  by_subject: { code: string; name: string; answered: number; correct: number }[];
  mastered: number;
  in_review: number;
}

export default async function AnalysisPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const sp = await searchParams;
  const me = await requireProfile();
  const { t } = await getT();
  const supabase = await createClient();

  const other = sp.user && UUID_RE.test(sp.user) && sp.user !== me.id ? sp.user : null;
  if (other && me.role !== "admin") notFound();
  const target = other ?? me.id;

  const [{ data: stats }, { data: an }, who] = await Promise.all([
    supabase.rpc("my_stats", { p_user: target }),
    supabase.from("student_analysis").select("content, generated_at").eq("user_id", target).maybeSingle(),
    other ? supabase.from("profiles").select("full_name").eq("id", other).maybeSingle() : null,
  ]);
  const s = (stats ?? { answered: 0, correct: 0, by_subject: [], mastered: 0, in_review: 0 }) as Stats;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title !mb-0">
          {t("analysis.title")}
          {who?.data && <span className="text-muted" dir="auto"> — {who.data.full_name as string}</span>}
        </h1>
        <Link href={other ? "/admin/accounts" : "/assistant"} className="text-sm text-accent hover:underline">{t("common.back")}</Link>
      </div>

      <div className="card grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="tech text-2xl font-semibold" dir="ltr">{s.answered}</p>
          <p className="text-xs text-muted">{t("analysis.answered")}</p>
        </div>
        <div>
          <p className="tech text-2xl font-semibold text-accent" dir="ltr">{pct(s.correct, s.answered)}%</p>
          <p className="text-xs text-muted">{t("analysis.accuracy")}</p>
        </div>
        <div>
          <p className="tech text-2xl font-semibold" dir="ltr">{s.mastered}/{s.mastered + s.in_review}</p>
          <p className="text-xs text-muted">{t("analysis.mastered")}</p>
        </div>
      </div>

      {s.by_subject.length > 0 && (
        <ul className="card space-y-2">
          {s.by_subject.map((x) => (
            <li key={x.code} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="tech" dir="ltr">{x.code}</span>
                <span className="tech text-muted" dir="ltr">{x.correct}/{x.answered} · {pct(x.correct, x.answered)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${pct(x.correct, x.answered)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("analysis.coach")}</h2>
        {an ? (
          <>
            <Rich>{an.content as string}</Rich>
            <p className="text-[11px] text-muted">{new Date(an.generated_at as string).toLocaleDateString()}</p>
          </>
        ) : (
          <p className="text-sm text-muted">{t("analysis.none")}</p>
        )}
        {!other && <AnalysisRefresh />}
      </section>
    </div>
  );
}
