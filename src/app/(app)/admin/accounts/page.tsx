import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { createAccount, createCohort, deleteAccount, resetPassword, updateAccount } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import type { Profile } from "@/lib/types";

export default async function AccountsPage() {
  const me = await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();
  const [{ data: cohorts }, { data: profiles }] = await Promise.all([
    supabase.from("cohorts").select("id, name").order("name"),
    supabase.from("profiles").select("id, full_name, email, phone, role, can_publish_direct, cohort_id").order("full_name"),
  ]);
  const cohortList = (cohorts ?? []) as { id: string; name: string }[];
  const cohortName = new Map(cohortList.map((c) => [c.id, c.name]));
  const people = (profiles ?? []) as Profile[];

  return (
    <div className="space-y-8">
      <section className="card">
        <h2 className="tech mb-4 text-sm font-semibold">{t("acc.new")}</h2>
        <ActionForm action={createAccount} submitLabel={t("common.create")} resetOnSuccess>
          <div>
            <label className="label" htmlFor="full_name">{t("acc.fullName")}</label>
            <input id="full_name" name="full_name" className="input" dir="auto" required maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="identifier">{t("acc.identifier")}</label>
            <input id="identifier" name="identifier" className="input" dir="ltr" required autoComplete="off" />
          </div>
          <div>
            <label className="label" htmlFor="password">{t("acc.password")}</label>
            <input id="password" name="password" type="text" className="input" dir="ltr" required minLength={8} autoComplete="off" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="role">{t("acc.role")}</label>
              <select id="role" name="role" className="input" defaultValue="student">
                <option value="student">{t("role.student")}</option>
                <option value="moderator">{t("role.moderator")}</option>
                <option value="admin">{t("role.admin")}</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cohort_id">{t("acc.cohort")}</label>
              <select id="cohort_id" name="cohort_id" className="input" defaultValue={cohortList[0]?.id ?? ""}>
                <option value="">{t("common.none")}</option>
                {cohortList.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" name="can_publish_direct" className="size-4 accent-[var(--accent)]" /> {t("acc.direct")} ({t("role.moderator")})
          </label>
        </ActionForm>
      </section>

      <section className="space-y-3" aria-labelledby="people-h">
        <h2 id="people-h" className="tech text-sm font-semibold">{t("admin.accounts")} ({people.length})</h2>
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.id}>
              <details className="card !p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" dir="auto">{p.full_name}</span>
                    <span className="tech block truncate text-xs text-muted" dir="ltr">{p.phone ?? p.email}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <span className="badge badge-accent">{t(`role.${p.role}`)}</span>
                    {p.cohort_id && <span className="badge">{cohortName.get(p.cohort_id)}</span>}
                  </span>
                </summary>

                <div className="mt-4 space-y-5">
                  {p.role === "student" && (
                    <Link href={`/assistant/analysis?user=${p.id}`} className="btn btn-sm">{t("admin.studentAnalysis")}</Link>
                  )}
                  <form action={updateAccount} className="space-y-3">
                    <input type="hidden" name="id" value={p.id} />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label" htmlFor={`r-${p.id}`}>{t("acc.role")}</label>
                        <select id={`r-${p.id}`} name="role" className="input" defaultValue={p.role}>
                          <option value="student">{t("role.student")}</option>
                          <option value="moderator">{t("role.moderator")}</option>
                          <option value="admin">{t("role.admin")}</option>
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor={`c-${p.id}`}>{t("acc.cohort")}</label>
                        <select id={`c-${p.id}`} name="cohort_id" className="input" defaultValue={p.cohort_id ?? ""}>
                          <option value="">{t("common.none")}</option>
                          {cohortList.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <label className="flex min-h-10 items-center gap-3 text-sm">
                      <input type="checkbox" name="can_publish_direct" defaultChecked={p.can_publish_direct} className="size-4 accent-[var(--accent)]" /> {t("acc.direct")}
                    </label>
                    <button className="btn btn-sm">{t("common.save")}</button>
                  </form>

                  <ActionForm action={resetPassword} submitLabel={t("acc.reset")} submitClassName="btn btn-sm" className="space-y-2" resetOnSuccess>
                    <input type="hidden" name="id" value={p.id} />
                    <input name="password" type="text" className="input" dir="ltr" minLength={8} required autoComplete="off" placeholder={t("acc.password")} aria-label={t("acc.password")} />
                  </ActionForm>

                  {p.id !== me.id && (
                    <form action={deleteAccount}>
                      <input type="hidden" name="id" value={p.id} />
                      <ConfirmButton>{t("acc.deleteAccount")}</ConfirmButton>
                    </form>
                  )}
                </div>
              </details>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2 className="tech mb-4 text-sm font-semibold">{t("acc.cohorts")}: {cohortList.map((c) => c.name).join("، ")}</h2>
        <ActionForm action={createCohort} submitLabel={t("acc.newCohort")} submitClassName="btn" resetOnSuccess>
          <input name="name" className="input" dir="auto" required maxLength={80} aria-label={t("acc.newCohort")} />
        </ActionForm>
      </section>
    </div>
  );
}
