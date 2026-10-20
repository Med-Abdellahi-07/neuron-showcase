import { requireManager } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/spaces";
import { createStudent, deleteStudent, resetStudentPassword } from "@/app/actions/accounts";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import { StudentImporter } from "@/components/student-importer";
import { relativeSeen } from "@/components/dashboard-bits";

const PAGE = 60;

/** إدارة طلاب الفضاء الحالي فقط: إنشاء فردي أو جماعي (CSV/Excel)، إعادة تعيين كلمة السر، حذف. */
export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; all?: string }> }) {
  const me = await requireManager();
  const { t } = await getT();
  const sp = await searchParams;
  const query = (sp.q ?? "").trim().slice(0, 60);
  const showAll = sp.all === "1";
  const space = await getSpace();

  const supabase = await createClient();
  let q = supabase
    .from("profiles")
    .select("id, full_name, email, phone, last_seen_at", { count: "exact" })
    .eq("role", "student")
    .eq("cohort_id", me.cohort_id ?? "")
    .order("full_name");
  if (query) q = q.ilike("full_name", `%${query.replace(/[%_,()]/g, " ")}%`);
  const { data, count } = await (showAll ? q : q.limit(PAGE));
  const people = (data ?? []) as { id: string; full_name: string; email: string | null; phone: string | null; last_seen_at: string | null }[];
  const total = count ?? people.length;

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        {t("dash.space")}: <span className="tech font-semibold text-fg" dir="ltr">{space?.name ?? "—"}</span>
      </p>

      <section className="card">
        <h2 className="tech mb-4 text-sm font-semibold">{t("acc.newStudent")}</h2>
        <ActionForm action={createStudent} submitLabel={t("common.create")} resetOnSuccess>
          <div>
            <label className="label" htmlFor="full_name">{t("acc.fullName")}</label>
            <input id="full_name" name="full_name" className="input" dir="auto" required maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="identifier">{t("acc.identifier")}</label>
            <input id="identifier" name="identifier" className="input" dir="ltr" inputMode="email" required />
          </div>
          <div>
            <label className="label" htmlFor="password">{t("acc.password")}</label>
            <input id="password" name="password" type="text" className="input" dir="ltr" minLength={8} required autoComplete="off" />
          </div>
        </ActionForm>
      </section>

      <StudentImporter />

      <section className="space-y-3" aria-labelledby="stu-h">
        <h2 id="stu-h" className="tech text-sm font-semibold">{t("dash.students")} ({total})</h2>
        <form method="get" className="flex gap-2">
          <input name="q" defaultValue={query} className="input flex-1" dir="auto" placeholder={t("acc.search")} aria-label={t("acc.search")} />
          <button className="btn">{t("acc.searchBtn")}</button>
        </form>
        {people.length === 0 && <p className="card text-sm text-muted">{t("dash.noStudents")}</p>}
        <ul className="space-y-2">
          {people.map((p) => (
            <li key={p.id}>
              <details className="card !p-3">
                <summary className="flex cursor-pointer items-center justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium" dir="auto">{p.full_name}</span>
                    <span className="tech block truncate text-xs text-muted" dir="ltr">{p.phone ?? p.email}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted">{relativeSeen(p.last_seen_at, t)}</span>
                </summary>
                <div className="mt-4 space-y-4">
                  <ActionForm action={resetStudentPassword} submitLabel={t("acc.reset")} submitClassName="btn btn-sm" className="space-y-2" resetOnSuccess>
                    <input type="hidden" name="id" value={p.id} />
                    <input name="password" type="text" className="input" dir="ltr" minLength={8} required autoComplete="off" placeholder={t("acc.password")} aria-label={t("acc.password")} />
                  </ActionForm>
                  <form action={deleteStudent}>
                    <input type="hidden" name="id" value={p.id} />
                    <ConfirmButton>{t("acc.deleteAccount")}</ConfirmButton>
                  </form>
                </div>
              </details>
            </li>
          ))}
        </ul>
        {!showAll && total > PAGE && (
          <a href={`?${new URLSearchParams({ ...(query ? { q: query } : {}), all: "1" })}`} className="btn w-full">{t("acc.showAll").replace("{n}", String(total))}</a>
        )}
      </section>
    </div>
  );
}
