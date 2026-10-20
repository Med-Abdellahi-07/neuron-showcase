import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { Tile, relativeSeen } from "@/components/dashboard-bits";
import type { DictKey } from "@/lib/i18n/dictionaries";

interface SpaceRow {
  id: string;
  name: string;
  is_active: boolean;
  plan: string;
  institution: string | null;
  students: number;
  active_7d: number;
  supervisors: number;
  lessons: number;
  questions: number;
  last_content_at: string | null;
}
interface Sup { id: string; full_name: string; role: string; space: string | null; last_seen_at: string | null; last_upload_at: string | null }

/** لوحة الجامعة (المشرف العام): كل الفضاءات مجمّعة حسب المؤسسة + نشاط المشرفين. بلا بيانات شخصية للطلاب. */
export async function UniversityDashboard() {
  const { t } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_overview");
  if (error || !data) return <p className="card text-sm text-warn">{t("stats.runMigration")}</p>;
  const ov = data as unknown as { spaces: SpaceRow[]; supervisors: Sup[] };

  const sum = (f: (s: SpaceRow) => number) => ov.spaces.reduce((a, s) => a + f(s), 0);
  const groups = new Map<string, SpaceRow[]>();
  for (const s of ov.spaces) groups.set(s.institution ?? "—", [...(groups.get(s.institution ?? "—") ?? []), s]);

  return (
    <section className="space-y-5" aria-labelledby="uni-h">
      <h2 id="uni-h" className="tech text-sm font-semibold">{t("dash.university")}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t("dash.students")} value={sum((s) => s.students)} />
        <Tile label={t("dash.active7")} value={sum((s) => s.active_7d)} />
        <Tile label={t("dash.lessons")} value={sum((s) => s.lessons)} />
        <Tile label={t("dash.questions")} value={sum((s) => s.questions)} />
      </div>
      <p className="text-xs text-muted">
        {t("dash.activeSpaces")}: <span className="tech font-semibold text-fg" dir="ltr">{ov.spaces.filter((s) => s.is_active).length}/{ov.spaces.length}</span>
      </p>

      {[...groups.entries()].map(([inst, list]) => (
        <div key={inst} className="card !p-0 overflow-hidden">
          <h3 className="tech border-b border-border px-4 py-2 text-xs font-semibold" dir="ltr">
            {inst}
            <span className="ms-2 text-muted">
              {list.reduce((a, s) => a + s.students, 0)} · {list.reduce((a, s) => a + s.active_7d, 0)}
            </span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-xs">
              <thead className="text-muted">
                <tr className="text-start">
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.space")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.students")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.active7")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.supervisors")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.lessons")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.questions")}</th>
                  <th scope="col" className="p-2 text-start font-medium">{t("dash.lastContent")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className={`border-t border-border ${s.is_active ? "" : "opacity-50"}`}>
                    <th scope="row" className="tech p-2 text-start font-semibold" dir="ltr">
                      {s.name} {!s.is_active && <span className="badge">{t("spaces.inactive")}</span>}
                    </th>
                    <td className="tech p-2" dir="ltr">{s.students}</td>
                    <td className="tech p-2" dir="ltr">{s.active_7d}</td>
                    <td className="tech p-2" dir="ltr">{s.supervisors}</td>
                    <td className="tech p-2" dir="ltr">{s.lessons}</td>
                    <td className="tech p-2" dir="ltr">{s.questions}</td>
                    <td className="p-2 text-muted">{relativeSeen(s.last_content_at, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      <div className="card space-y-2">
        <h3 className="text-xs font-semibold text-muted">{t("dash.supervisorActivity")}</h3>
        {ov.supervisors.length === 0 ? <p className="text-sm text-muted">{t("dash.noSupervisors")}</p> : (
          <ul className="space-y-2 text-sm">
            {ov.supervisors.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                <span className="min-w-0 truncate" dir="auto">
                  {s.full_name} <span className="badge">{t(`role.${s.role}` as DictKey)}</span>{" "}
                  <span className="tech text-xs text-muted" dir="ltr">{s.space ?? ""}</span>
                </span>
                <span className="text-xs text-muted">
                  {t("dash.lastSeen")}: {relativeSeen(s.last_seen_at, t)} · {t("dash.lastUpload")}: {relativeSeen(s.last_upload_at, t)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
