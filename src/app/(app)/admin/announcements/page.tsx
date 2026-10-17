import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { createAnnouncement, deleteAnnouncement } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmButton } from "@/components/confirm-button";
import type { Announcement } from "@/lib/types";

export default async function AnnouncementsPage() {
  const profile = await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();
  const [{ data: cohorts }, { data: anns }] = await Promise.all([
    supabase.from("cohorts").select("id, name").order("name"),
    supabase.from("announcements").select("*").order("created_at", { ascending: false }).limit(30),
  ]);
  const cohortList = (cohorts ?? []) as { id: string; name: string }[];
  const names = new Map(cohortList.map((c) => [c.id, c.name]));
  const list = (anns ?? []) as Announcement[];

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="tech mb-4 text-sm font-semibold">{t("ann.new")}</h2>
        <ActionForm action={createAnnouncement} submitLabel={t("ann.publish")} resetOnSuccess>
          <div>
            <label className="label" htmlFor="cohort_id">{t("acc.cohort")}</label>
            <select id="cohort_id" name="cohort_id" className="input" required defaultValue={profile.cohort_id ?? cohortList[0]?.id}>
              {cohortList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="title">{t("ann.title")}</label>
            <input id="title" name="title" className="input" dir="auto" required maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="body">{t("ann.body")}</label>
            <textarea id="body" name="body" className="input min-h-24" dir="auto" maxLength={4000} />
          </div>
          <div>
            <label className="label" htmlFor="expires_on">{t("ann.expires")}</label>
            <input id="expires_on" name="expires_on" type="date" className="input" />
            <p className="mt-1 text-xs text-muted">{t("ann.expiresHelp")}</p>
          </div>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" name="pinned" className="size-4 accent-[var(--accent)]" /> {t("ann.pinned")}
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" name="notify" defaultChecked className="size-4 accent-[var(--accent)]" /> {t("ann.notify")}
          </label>
        </ActionForm>
      </section>

      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="card space-y-1 !p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium" dir="auto">{a.pinned && "📌 "}{a.title}</p>
              <span className="badge shrink-0">{names.get(a.cohort_id)}</span>
            </div>
            {a.expires_at && (
              <p className="tech text-xs text-muted" dir="ltr">
                {new Date(a.expires_at) < new Date() ? `${t("ann.expired")} · ` : `${t("ann.expiresOn")} `}
                {a.expires_at.slice(0, 10)}
              </p>
            )}
            {a.body && <p className="line-clamp-3 whitespace-pre-line text-sm text-muted" dir="auto">{a.body}</p>}
            <form action={deleteAnnouncement}>
              <input type="hidden" name="id" value={a.id} />
              <ConfirmButton>{t("common.delete")}</ConfirmButton>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
