import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions/auth";
import { LangSwitch } from "@/components/lang-switch";
import { ENGLISH_CODE } from "@/lib/constants";
import { getSubjectByCode } from "@/lib/data";
import { ThemeSelect } from "./theme-select";
import { PreferencesForm } from "./preferences-form";
import { PasswordForm } from "./password-form";

export default async function ProfilePage() {
  const profile = await requireProfile();
  const { t } = await getT();
  const supabase = await createClient();

  // مجموعات الإنجليزية المعروفة من الجدول، كاقتراحات
  let groupOptions: string[] = [];
  if (profile.cohort_id) {
    const subject = await getSubjectByCode(ENGLISH_CODE);
    if (subject) {
      const { data } = await supabase
        .from("schedule_sessions")
        .select("group_label")
        .eq("cohort_id", profile.cohort_id)
        .eq("subject_id", subject.id)
        .not("group_label", "is", null);
      groupOptions = [...new Set((data ?? []).map((r) => r.group_label as string))].sort();
    }
  }
  const isStaff = profile.role !== "student";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title !mb-1">{profile.full_name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-accent">{t(`role.${profile.role}`)}</span>
          <span className="tech text-xs text-muted" dir="ltr">{profile.phone ?? profile.email}</span>
        </div>
      </div>

      {isStaff && (
        <Link href="/admin" className="btn w-full">
          <ShieldCheck size={16} aria-hidden /> {t("profile.admin")}
        </Link>
      )}

      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold text-muted">{t("profile.language")}</h2>
        <LangSwitch />
      </section>

      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold text-muted">{t("profile.theme")}</h2>
        <ThemeSelect />
      </section>

      <section className="card">
        <PreferencesForm
          englishGroup={profile.english_group ?? ""}
          hideFromRanking={profile.hide_from_ranking}
          groupOptions={groupOptions}
        />
      </section>

      <section className="card space-y-2 opacity-70">
        <h2 className="tech text-sm font-semibold text-muted">{t("profile.notifications")}</h2>
        <p className="text-xs text-muted">{t("profile.notificationsSoon")}</p>
      </section>

      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold text-muted">{t("profile.password")}</h2>
        <PasswordForm />
      </section>

      <form action={logout}>
        <button className="btn btn-danger w-full">{t("profile.logout")}</button>
      </form>
    </div>
  );
}
