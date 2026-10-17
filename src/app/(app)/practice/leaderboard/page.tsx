import Link from "next/link";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { appTimeZone } from "@/lib/dates";
import { PracticeTabs } from "@/components/practice-tabs";

type SP = Record<string, string | string[] | undefined>;

interface Row {
  user_id: string;
  full_name: string;
  points: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  rank: number;
  is_me: boolean;
  hidden: boolean;
}

const fmt = (n: number) => (Math.round(Number(n) * 10) / 10).toString();

export default async function LeaderboardPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUserId();
  const sp = await searchParams;
  const raw = Array.isArray(sp.scope) ? sp.scope[0] : sp.scope;
  const scope = raw === "semester" ? "semester" : "week";
  const { t } = await getT();
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("leaderboard", { p_scope: scope, p_tz: appTimeZone() });
  if (error) console.error("leaderboard failed:", error.message);
  const rows = (data ?? []) as Row[];
  const me = rows.find((r) => r.is_me);

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0">{t("practice.title")}</h1>
      <PracticeTabs />

      <div className="flex items-center justify-between gap-2">
        <h2 className="tech text-sm font-semibold">{t("lb.title")}</h2>
        <div className="flex gap-1.5" role="group" aria-label={t("lb.title")}>
          {(["week", "semester"] as const).map((s) => (
            <Link
              key={s}
              href={`/practice/leaderboard?scope=${s}`}
              aria-current={scope === s ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${
                scope === s ? "border-transparent bg-primary text-primary-fg" : "border-border text-muted hover:text-fg"
              }`}
            >
              {t(s === "week" ? "lb.week" : "lb.semester")}
            </Link>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        {t(scope === "week" ? "lb.weekNote" : "lb.semesterNote")} {t("lb.rules")}
      </p>

      {me?.hidden && <p className="card text-sm text-warn">{t("lb.hiddenNote")}</p>}

      {rows.length === 0 ? (
        <p className="card text-sm text-muted">{t("lb.empty")}</p>
      ) : (
        <div className="card overflow-hidden !p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th scope="col" className="w-10 px-3 py-2 text-start font-medium">{t("lb.rank")}</th>
                <th scope="col" className="px-3 py-2 text-start font-medium">{t("lb.name")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("lb.points")}</th>
                <th scope="col" className="px-3 py-2 text-end font-medium">{t("lb.accuracy")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id} className={`border-t border-border ${r.is_me ? "bg-accent-soft font-semibold" : ""}`}>
                  <td className="tech px-3 py-2.5" dir="ltr">{r.rank}</td>
                  <td className="min-w-0 px-3 py-2.5" dir="auto">
                    {r.full_name}
                    {r.is_me && <span className="badge badge-accent ms-2">{t("lb.you")}</span>}
                  </td>
                  <td className="tech px-3 py-2.5 text-end" dir="ltr">{fmt(r.points)}</td>
                  <td className="tech px-3 py-2.5 text-end" dir="ltr">
                    {r.accuracy === null ? "—" : `${fmt(r.accuracy)}%`}
                    <span className="block text-[11px] font-normal text-muted">
                      {r.correct}/{r.answered}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
