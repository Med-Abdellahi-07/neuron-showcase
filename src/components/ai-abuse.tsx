import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { setAiLimits } from "@/app/actions/ai-admin";
import { formatDate } from "@/lib/dates";

interface Top { user_id: string; full_name: string; space_name: string | null; today: number; week: number }
interface Alert { user_id: string; full_name: string; space_name: string | null; kind: "minute" | "daily"; day: string }

/** Hidden abuse cap + top 10 accounts by usage + abuse alerts (super admin only). */
export async function AiAbuse() {
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [lim, top, alerts] = await Promise.all([
    supabase.rpc("ai_get_limits"),
    supabase.rpc("ai_top_users", { p_limit: 10 }),
    supabase.rpc("ai_recent_alerts", { p_days: 7 }),
  ]);
  if (lim.error || !lim.data) return null;
  const l = lim.data as { daily_cap: number; minute_cap: number };
  const topRows = (top.data ?? []) as Top[];
  const alertRows = (alerts.data ?? []) as Alert[];
  return (
    <section className="space-y-3" aria-labelledby="abuse-h">
      <h2 id="abuse-h" className="tech text-sm font-semibold">{t("aiadm.limits.title")}</h2>
      {alertRows.length > 0 && (
        <div role="alert" className="card space-y-1.5 border border-warn">
          <h3 className="text-sm font-semibold text-warn">{t("aiadm.alerts.title")} ({alertRows.length})</h3>
          <ul className="space-y-1 text-sm">
            {alertRows.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2">
                <span dir="auto">{a.full_name} <span className="tech text-xs text-muted" dir="ltr">{a.space_name}</span></span>
                <span className="tech text-xs text-muted">{t(`aiadm.alertKind.${a.kind}`)} · {formatDate(a.day, locale)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ActionForm action={setAiLimits} submitLabel={t("common.save")} className="card space-y-3" submitClassName="btn btn-sm btn-primary">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="cap-d">{t("aiadm.limits.daily")}</label>
            <input id="cap-d" name="daily" type="number" min={10} max={5000} defaultValue={l.daily_cap} className="input" dir="ltr" />
          </div>
          <div>
            <label className="label" htmlFor="cap-m">{t("aiadm.limits.minute")}</label>
            <input id="cap-m" name="minute" type="number" min={1} max={120} defaultValue={l.minute_cap} className="input" dir="ltr" />
          </div>
        </div>
        <p className="text-xs text-muted">{t("aiadm.limits.help")}</p>
      </ActionForm>
      <div className="card space-y-2">
        <h3 className="text-sm font-semibold">{t("aiadm.top.title")}</h3>
        {topRows.length === 0 ? <p className="text-sm text-muted">{t("aiadm.top.none")}</p> : (
          <ol className="space-y-1 text-sm">
            {topRows.map((u, i) => (
              <li key={u.user_id} className="flex items-center justify-between gap-2">
                <span dir="auto"><span className="tech text-xs text-muted">{i + 1}.</span> {u.full_name} <span className="tech text-xs text-muted" dir="ltr">{u.space_name}</span></span>
                <span className="tech text-xs" dir="ltr">{u.today} / {u.week}</span>
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted">{t("aiadm.today")} / {t("aiadm.week")} ({t("aiadm.requests")})</p>
      </div>
    </section>
  );
}
