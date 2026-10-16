import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAllSubjects } from "@/lib/data";
import { LESSON_KINDS } from "@/lib/constants";
import { createLesson } from "@/app/actions/content";
import { ActionForm } from "@/components/action-form";
import { StatusBadge } from "@/components/status-badge";
import type { Lesson } from "@/lib/types";

export default async function AdminContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const profile = await requireStaff();
  const { t } = await getT();
  const sp = await searchParams;
  const filterCode = (Array.isArray(sp.s) ? sp.s[0] : sp.s) ?? "";
  const supabase = await createClient();

  const [subjects, { data }] = await Promise.all([
    getAllSubjects(),
    supabase.from("lessons").select("*").order("number"),
  ]);
  const lessons = (data ?? []) as Lesson[];
  const shown = subjects.filter((s) => !filterCode || s.code === filterCode);

  return (
    <div className="space-y-6">
      {profile.role === "moderator" && !profile.can_publish_direct && (
        <p className="card text-xs text-muted">{t("content.pendingNote")}</p>
      )}

      <details className="card" open={lessons.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">{t("content.new")}</summary>
        <ActionForm action={createLesson} submitLabel={t("common.create")} className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="label" htmlFor="subject_id">{t("common.subject")}</label>
              <select id="subject_id" name="subject_id" className="input" required dir="auto" defaultValue={subjects.find((s) => s.code === filterCode)?.id ?? ""}>
                <option value="" disabled></option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="kind">{t("common.type")}</label>
              <select id="kind" name="kind" className="input" required>
                {LESSON_KINDS.map((k) => (
                  <option key={k} value={k}>{t(`kind.${k}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="number">{t("common.number")}</label>
              <input id="number" name="number" type="number" min={1} className="input" dir="ltr" required />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="title">{t("common.title")}</label>
              <input id="title" name="title" className="input" dir="auto" required maxLength={200} />
            </div>
            <div className="col-span-2">
              <label className="label" htmlFor="lesson_date">{t("common.date")} ({t("common.optional")})</label>
              <input id="lesson_date" name="lesson_date" type="date" className="input" dir="ltr" />
            </div>
          </div>
        </ActionForm>
      </details>

      <form method="get" className="flex items-end gap-2">
        <div className="flex-1">
          <label className="label" htmlFor="s">{t("common.subject")}</label>
          <select id="s" name="s" className="input" defaultValue={filterCode} dir="auto">
            <option value="">{t("common.all")}</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <button className="btn">OK</button>
      </form>

      {shown.map((s) => {
        const own = lessons.filter((l) => l.subject_id === s.id);
        if (!own.length) return null;
        return (
          <section key={s.id} className="space-y-3" aria-labelledby={`s-${s.id}`}>
            <h2 id={`s-${s.id}`} className="tech text-sm font-semibold" dir="auto">
              <span className="text-accent" dir="ltr">{s.code}</span> · {s.name}
            </h2>
            {LESSON_KINDS.map((k) => {
              const ofKind = own.filter((l) => l.kind === k);
              if (!ofKind.length) return null;
              return (
                <div key={k}>
                  <p className="tech mb-1 text-xs text-muted">{t(`kind.${k}`)}</p>
                  <ul className="space-y-1.5">
                    {ofKind.map((l) => (
                      <li key={l.id}>
                        <Link href={`/admin/content/${l.id}`} className="card flex items-center gap-3 !p-3 transition-colors hover:bg-surface-2">
                          <span className="tech w-7 text-sm text-muted" dir="ltr">{l.number}</span>
                          <span className="min-w-0 flex-1 truncate text-sm" dir="auto">{l.title}</span>
                          <StatusBadge status={l.status} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
