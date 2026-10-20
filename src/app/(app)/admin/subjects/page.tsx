import { requireManager } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { createSubject, deleteSubject, updateSubject } from "@/app/actions/subjects";
import type { Subject } from "@/lib/types";

interface Sem {
  id: string;
  code: string;
  name: string;
  is_current: boolean;
}

function NumberField({ name, label, value }: { name: string; label: string; value?: number }) {
  return (
    <div>
      <label className="label" htmlFor={`${name}-${value ?? "new"}`}>{label}</label>
      <input id={`${name}-${value ?? "new"}`} name={name} type="number" min={0} max={999} defaultValue={value ?? 0} className="input" dir="ltr" />
    </div>
  );
}

export default async function SubjectsAdminPage() {
  await requireManager();
  const { t } = await getT();
  const supabase = await createClient();
  const [{ data: sems }, { data: subs }] = await Promise.all([
    supabase.from("semesters").select("id, code, name, is_current").order("code"),
    supabase.from("subjects").select("*").order("sort"),
  ]);
  const semesters = (sems ?? []) as Sem[];
  const subjects = (subs ?? []) as Subject[];

  return (
    <div className="space-y-8">
      <section className="card">
        <h2 className="tech mb-4 text-sm font-semibold">{t("subj.new")}</h2>
        <ActionForm action={createSubject} submitLabel={t("common.create")} resetOnSuccess>
          <div>
            <label className="label" htmlFor="semester_id">{t("subj.semester")}</label>
            <select id="semester_id" name="semester_id" className="input" defaultValue={semesters.find((s) => s.is_current)?.id} required>
              {semesters.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor="code">{t("subj.code")}</label>
              <input id="code" name="code" className="input" dir="ltr" required maxLength={20} />
            </div>
            <NumberField name="credits" label={t("subj.credits")} />
          </div>
          <div>
            <label className="label" htmlFor="name">{t("subj.name")}</label>
            <input id="name" name="name" className="input" dir="auto" required maxLength={160} />
          </div>
          <div className="grid grid-cols-4 gap-3">
            <NumberField name="cm_hours" label="CM" />
            <NumberField name="td_hours" label="TD" />
            <NumberField name="tp_hours" label="TP" />
            <NumberField name="sort" label={t("subj.sort")} />
          </div>
        </ActionForm>
      </section>

      {semesters.map((sem) => {
        const list = subjects.filter((s) => s.semester_id === sem.id);
        return (
          <section key={sem.id} className="space-y-3" aria-labelledby={`sem-${sem.id}`}>
            <h2 id={`sem-${sem.id}`} className="tech text-sm font-semibold">
              {sem.code} — {sem.name} ({list.length}){sem.is_current && <span className="badge badge-accent ms-2">{t("subj.current")}</span>}
            </h2>
            {list.length === 0 && <p className="card text-sm text-muted">{t("subj.none")}</p>}
            <ul className="space-y-2">
              {list.map((s) => (
                <li key={s.id}>
                  <details className="card !p-3">
                    <summary className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="tech text-xs text-accent" dir="ltr">{s.code}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">{s.name}</span>
                    </summary>
                    <form action={updateSubject} className="mt-4 space-y-3">
                      <input type="hidden" name="id" value={s.id} />
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label" htmlFor={`code-${s.id}`}>{t("subj.code")}</label>
                          <input id={`code-${s.id}`} name="code" defaultValue={s.code} className="input" dir="ltr" required maxLength={20} />
                        </div>
                        <div>
                          <label className="label" htmlFor={`credits-${s.id}`}>{t("subj.credits")}</label>
                          <input id={`credits-${s.id}`} name="credits" type="number" min={0} max={999} defaultValue={s.credits} className="input" dir="ltr" />
                        </div>
                      </div>
                      <div>
                        <label className="label" htmlFor={`name-${s.id}`}>{t("subj.name")}</label>
                        <input id={`name-${s.id}`} name="name" defaultValue={s.name} className="input" dir="auto" required maxLength={160} />
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {(["cm_hours", "td_hours", "tp_hours", "sort"] as const).map((k) => (
                          <div key={k}>
                            <label className="label" htmlFor={`${k}-${s.id}`}>{k === "sort" ? t("subj.sort") : k.slice(0, 2).toUpperCase()}</label>
                            <input id={`${k}-${s.id}`} name={k} type="number" min={0} max={999} defaultValue={s[k]} className="input" dir="ltr" />
                          </div>
                        ))}
                      </div>
                      <button className="btn btn-sm btn-primary">{t("common.save")}</button>
                    </form>
                    <form action={deleteSubject} className="mt-3">
                      <input type="hidden" name="id" value={s.id} />
                      <ConfirmButton>{t("subj.delete")}</ConfirmButton>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
