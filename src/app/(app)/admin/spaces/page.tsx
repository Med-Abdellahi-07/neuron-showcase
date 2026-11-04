import { notFound } from "next/navigation";
import { MULTI_SPACE } from "@/lib/flags";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { FEATURES, pickName, SPACE_SELECT, toSpace, type Space } from "@/lib/spaces";
import { setSpaceActive, setSpaceFeature, setSpacePlan, switchSpace } from "@/app/actions/spaces";
import type { DictKey } from "@/lib/i18n/dictionaries";

export default async function SpacesAdminPage() {
  if (!MULTI_SPACE) notFound();
  const me = await requireAdmin();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [{ data: rows }, { data: sup }, { data: stu }] = await Promise.all([
    supabase.from("cohorts").select(SPACE_SELECT).order("name"),
    supabase.from("profiles").select("cohort_id").in("role", ["space_admin"]),
    supabase.from("profiles").select("cohort_id").eq("role", "student"),
  ]);
  const spaces = (rows ?? []).map((r) => toSpace(r as never));
  const countBy = (list: { cohort_id: string | null }[] | null) => {
    const m = new Map<string, number>();
    for (const x of list ?? []) if (x.cohort_id) m.set(x.cohort_id, (m.get(x.cohort_id) ?? 0) + 1);
    return m;
  };
  const admins = countBy(sup);
  const students = countBy(stu);

  const byInstitution = new Map<string, Space[]>();
  for (const s of spaces) {
    const key = s.major?.institution.code ?? "—";
    byInstitution.set(key, [...(byInstitution.get(key) ?? []), s]);
  }

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted">{t("spaces.help")}</p>
      {[...byInstitution.entries()].map(([inst, list]) => (
        <section key={inst} className="space-y-3" aria-labelledby={`inst-${inst}`}>
          <h2 id={`inst-${inst}`} className="tech text-sm font-semibold" dir="ltr">
            {inst} <span className="text-muted" dir="auto">· {pickName(list[0].major?.institution.name, locale)}</span>
          </h2>
          <ul className="space-y-2">
            {list.map((s) => (
              <li key={s.id}>
                <details className="card !p-3">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <span className="tech text-sm font-semibold" dir="ltr">{s.name}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted" dir="auto">{pickName(s.major?.name, locale)}</span>
                    <span className={`badge ${s.is_active ? "badge-accent" : ""}`}>{t(s.is_active ? "spaces.active" : "spaces.inactive")}</span>
                    <span className="badge">{t(`plan.${s.plan}` as DictKey)}</span>
                    <span className="tech text-xs text-muted" dir="ltr">{students.get(s.id) ?? 0} · {admins.get(s.id) ?? 0}</span>
                  </summary>

                  <div className="mt-4 space-y-4">
                    <div className="flex flex-wrap gap-2">
                      {s.id !== me.cohort_id && (
                        <form action={switchSpace}>
                          <input type="hidden" name="cohort_id" value={s.id} />
                          <button className="btn btn-sm btn-primary">{t("space.enter")}</button>
                        </form>
                      )}
                      <form action={setSpaceActive}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="value" value={s.is_active ? "0" : "1"} />
                        <button className="btn btn-sm">{t(s.is_active ? "spaces.deactivate" : "spaces.activate")}</button>
                      </form>
                    </div>

                    <form action={setSpacePlan} className="flex items-end gap-2">
                      <input type="hidden" name="id" value={s.id} />
                      <div className="flex-1">
                        <label className="label" htmlFor={`plan-${s.id}`}>{t("spaces.plan")}</label>
                        <select id={`plan-${s.id}`} name="plan" className="input" defaultValue={s.plan === "custom" ? "basic" : s.plan}>
                          <option value="full">{t("plan.full")}</option>
                          <option value="basic">{t("plan.basic")}</option>
                        </select>
                      </div>
                      <button className="btn btn-sm">{t("spaces.applyPlan")}</button>
                    </form>

                    <div>
                      <p className="label">{t("spaces.features")}</p>
                      <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {FEATURES.map((f) => (
                          <li key={f}>
                            <form action={setSpaceFeature} className="flex min-h-10 items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 text-sm">
                              <input type="hidden" name="id" value={s.id} />
                              <input type="hidden" name="feature" value={f} />
                              <input type="hidden" name="value" value={s.features[f] ? "0" : "1"} />
                              <span>{t(`feat.${f}` as DictKey)}</span>
                              <button className={`btn btn-sm ${s.features[f] ? "btn-primary" : ""}`} aria-pressed={s.features[f]}>
                                {t(s.features[f] ? "spaces.on" : "spaces.off")}
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
