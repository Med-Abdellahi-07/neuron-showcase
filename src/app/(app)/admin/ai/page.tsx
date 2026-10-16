import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { AiDiagnostics } from "@/components/ai-diagnostics";

export default async function AdminAiPage() {
  await requireAdmin();
  const { t } = await getT();
  return (
    <div className="space-y-4">
      <h2 className="tech text-sm font-semibold">{t("admin.aiMenu")}</h2>
      <p className="text-sm text-muted">{t("admin.aiDesc")}</p>
      <AiDiagnostics />
    </div>
  );
}
