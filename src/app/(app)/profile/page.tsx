import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { logout } from "@/app/actions/auth";
import { LangSwitch } from "@/components/lang-switch";
import { ENGLISH_CODE } from "@/lib/constants";
import { getSubjectByCode } from "@/lib/data";
import { vapidPublicKey } from "@/lib/push";
import { NotificationSettings } from "@/components/notification-settings";
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
  const { data: prefRow } = await supabase.from("notification_prefs").select("lesson_tomorrow, schedule_change, new_content, duel, review, announcement").eq("user_id", profile.id).maybeSingle();
  const prefs = {
    lesson_tomorrow: prefRow?.lesson_tomorrow ?? true,
    schedule_change: prefRow?.schedule_change ?? true,
    new_content: prefRow?.new_content ?? true,
    duel: prefRow?.duel ?? true,
    review: prefRow?.review ?? true,
    announcement: prefRow?.announcement ?? true,
  };

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

      <section className="card space-y-3" aria-labelledby="notif-h">
        <h2 id="notif-h" className="tech text-sm font-semibold text-muted">{t("profile.notifications")}</h2>
        <NotificationSettings publicKey={vapidPublicKey()} initial={prefs} />
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
