import { Check, X } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VapidGenerator } from "@/components/vapid-generator";

export default async function NotificationsAdminPage() {
  await requireAdmin();
  const { t } = await getT();

  const env = [
    ["VAPID_PUBLIC_KEY", !!process.env.VAPID_PUBLIC_KEY?.trim()],
    ["VAPID_PRIVATE_KEY", !!process.env.VAPID_PRIVATE_KEY?.trim()],
    ["VAPID_SUBJECT", !!process.env.VAPID_SUBJECT?.trim()],
    ["CRON_SECRET", !!process.env.CRON_SECRET?.trim()],
    ["SUPABASE_SERVICE_ROLE_KEY", !!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()],
  ] as const;

  let devices = 0;
  let users = 0;
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("push_subscriptions").select("user_id");
    devices = data?.length ?? 0;
    users = new Set((data ?? []).map((r) => r.user_id as string)).size;
  } catch {
    /* Key not configured */
  }

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("notif.admin.status")}</h2>
        <ul className="space-y-1.5 text-sm">
          {env.map(([name, ok]) => (
            <li key={name} className="flex items-center gap-2" dir="ltr">
              {ok ? <Check size={16} className="text-success" aria-label="OK" /> : <X size={16} className="text-danger" aria-label="missing" />}
              <span className="tech text-xs">{name}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          {t("notif.admin.devices")}: <span className="tech" dir="ltr">{devices}</span> · {t("notif.admin.users")}: <span className="tech" dir="ltr">{users}</span>
        </p>
      </section>

      <section className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("notif.admin.keys")}</h2>
        <p className="text-sm text-muted">{t("notif.admin.keysHelp")}</p>
        <VapidGenerator />
      </section>

      <section className="card space-y-2">
        <h2 className="tech text-sm font-semibold">{t("notif.admin.schedule")}</h2>
        <p className="text-sm text-muted">{t("notif.admin.scheduleHelp")}</p>
      </section>
    </div>
  );
}
