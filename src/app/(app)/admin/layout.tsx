import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getSpace } from "@/lib/spaces";
import { AdminTabs } from "@/components/admin-tabs";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireStaff();
  const { t } = await getT();
  const space = await getSpace();
  return (
    <div className="compact">
      <h1 className="page-title !mb-3">{t("admin.title")}</h1>
      <AdminTabs role={profile.role as "moderator" | "space_admin" | "admin"} features={space?.features ?? {}} />
      {children}
    </div>
  );
}
