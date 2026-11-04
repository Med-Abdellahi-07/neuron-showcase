import { MULTI_SPACE, SINGLE_SPACE_NAME } from "@/lib/flags";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/spaces";
import { Tile, relativeSeen } from "@/components/dashboard-bits";
import type { DictKey } from "@/lib/i18n/dictionaries";

interface Dash {
  students: number;
  active_1d: number;
  active_7d: number;
  never_logged: number;
  subjects: number;
  lessons_published: number;
  lessons_pending: number;
  questions_published: number;
  questions_pending: number;
  sessions_next_7d: number;
  announcements: number;
  staff: { id: string; full_name: string; role: string; last_seen_at: string | null }[];
  recent_students: { id: string; full_name: string; last_seen_at: string | null }[];
}

/** لوحة الفضاء الحالي: إحصاءاته وحدها (الدالة تقيّد بفضاء المستخدم في قاعدة البيانات). */
export async function SpaceDashboard() {
  const { t } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("space_dashboard");
  if (error || !data) return <p className="card text-sm text-warn">{t("stats.runMigration")}</p>;
  const d = data as unknown as Dash;
  const space = await getSpace();

  return (
    <section className="space-y-4" aria-labelledby="space-dash-h">
      <h2 id="space-dash-h" className="tech text-sm font-semibold" dir="ltr">{MULTI_SPACE ? (space?.name ?? "") : SINGLE_SPACE_NAME}{MULTI_SPACE && <span className="text-muted" dir="auto"> · {t("dash.space")}</span>}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Tile label={t("dash.students")} value={d.students} />
        <Tile label={t("dash.active7")} value={d.active_7d} />
        <Tile label={t("dash.active1")} value={d.active_1d} />
        <Tile label={t("dash.lessons")} value={d.lessons_published} />
        <Tile label={t("dash.questions")} value={d.questions_published} />
        <Tile label={t("dash.sessions7")} value={d.sessions_next_7d} />
        <Tile label={t("dash.subjects")} value={d.subjects} />
        <Tile label={t("dash.pending")} value={d.lessons_pending + d.questions_pending} tone={d.lessons_pending + d.questions_pending > 0 ? "warn" : undefined} />
        <Tile label={t("dash.neverLogged")} value={d.never_logged} tone={d.never_logged > 0 ? "warn" : undefined} />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-muted">{t("dash.staff")}</h3>
          {d.staff.length === 0 ? <p className="text-sm text-muted">—</p> : (
            <ul className="space-y-1.5 text-sm">
              {d.staff.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" dir="auto">{s.full_name} <span className="badge">{t(`role.${s.role}` as DictKey)}</span></span>
                  <span className="shrink-0 text-xs text-muted">{relativeSeen(s.last_seen_at, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-muted">{t("dash.recentStudents")}</h3>
          {d.recent_students.length === 0 ? <p className="text-sm text-muted">{t("dash.noStudents")}</p> : (
            <ul className="space-y-1.5 text-sm">
              {d.recent_students.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate" dir="auto">{s.full_name}</span>
                  <span className="shrink-0 text-xs text-muted">{relativeSeen(s.last_seen_at, t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
