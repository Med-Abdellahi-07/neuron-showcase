import { MULTI_SPACE } from "@/lib/flags";
import { requireManager } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSpace } from "@/lib/spaces";
import { addRemainingSubject, createStudent, deleteStudent, removeRemainingSubject, resetStudentPassword } from "@/app/actions/accounts";
import { createAdminClient } from "@/lib/supabase/admin";
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

  // المواد المتبقية: لفضاءات L2 فقط، من L1 لنفس التخصص (القيد الحقيقي في قاعدة البيانات)
  const isL2 = MULTI_SPACE && space?.level_code === "L2";
  type RemRow = { student_id: string; subject_id: string };
  let l1Subjects: { id: string; code: string; name: string }[] = [];
  let rem: RemRow[] = [];
  if (isL2 && me.cohort_id && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data: mine } = await supabase.from("cohorts").select("major_id").eq("id", me.cohort_id).maybeSingle();
    if (mine?.major_id) {
      const admin = createAdminClient();
      const { data: l1 } = await admin.from("cohorts").select("id").eq("major_id", mine.major_id).eq("level_code", "L1").maybeSingle();
      if (l1) {
        const { data: sj } = await admin.from("subjects").select("id, code, name").eq("cohort_id", l1.id).order("code");
        l1Subjects = (sj ?? []) as typeof l1Subjects;
      }
    }
    const { data: r } = await supabase.from("remaining_subjects").select("student_id, subject_id");
    rem = (r ?? []) as RemRow[];
  }
  const subjName = new Map(l1Subjects.map((x) => [x.id, x]));

  // مشرف L1: متابعو مواد فضائه من L2 (قراءة فقط، أسماء بلا بيانات اتصال)
  const { data: fol } = MULTI_SPACE ? await supabase.rpc("l1_followers") : { data: [] };
  const followers = (fol ?? []) as { student_name: string; student_space: string | null; subject_code: string; subject_name: string }[];

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted">
        IAA L2
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

      {followers.length > 0 && (
        <section className="card space-y-3" aria-labelledby="fol-h">
          <div>
            <h2 id="fol-h" className="tech text-sm font-semibold">{t("rem.followersTitle")}</h2>
            <p className="mt-1 text-xs text-muted">{t("rem.followersHelp")}</p>
          </div>
          <ul className="space-y-1.5 text-sm">
            {followers.map((f, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2">
                <span dir="auto">{f.student_name} <span className="tech text-xs text-muted" dir="ltr">{f.student_space}</span></span>
                <span className="badge badge-accent tech" dir="ltr">{f.subject_code}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                  {isL2 && (
                    <div className="space-y-2 rounded-2xl bg-surface-2 p-3">
                      <p className="text-xs font-semibold text-muted">{t("rem.manageTitle")}</p>
                      {rem.filter((r) => r.student_id === p.id).length === 0 && <p className="text-xs text-muted">{t("rem.none")}</p>}
                      <ul className="space-y-1">
                        {rem.filter((r) => r.student_id === p.id).map((r) => (
                          <li key={r.subject_id} className="flex items-center justify-between gap-2 text-sm">
                            <span dir="auto"><span className="tech text-xs text-accent" dir="ltr">{subjName.get(r.subject_id)?.code}</span> {subjName.get(r.subject_id)?.name}</span>
                            <form action={removeRemainingSubject}>
                              <input type="hidden" name="student_id" value={p.id} />
                              <input type="hidden" name="subject_id" value={r.subject_id} />
                              <ConfirmButton className="btn btn-sm">{t("rem.remove")}</ConfirmButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                      {l1Subjects.filter((x) => !rem.some((r) => r.student_id === p.id && r.subject_id === x.id)).length > 0 ? (
                        <ActionForm action={addRemainingSubject} submitLabel={t("rem.add")} submitClassName="btn btn-sm" className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="student_id" value={p.id} />
                          <select name="subject_id" className="input min-w-0 flex-1" aria-label={t("rem.pick")} required defaultValue="">
                            <option value="" disabled>{t("rem.pick")}</option>
                            {l1Subjects.filter((x) => !rem.some((r) => r.student_id === p.id && r.subject_id === x.id)).map((x) => (
                              <option key={x.id} value={x.id}>{x.code} — {x.name}</option>
                            ))}
                          </select>
                        </ActionForm>
                      ) : (
                        <p className="text-xs text-muted">{l1Subjects.length === 0 ? t("rem.noL1") : t("rem.allAdded")}</p>
                      )}
                    </div>
                  )}
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
