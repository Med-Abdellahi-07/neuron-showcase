import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { getAllSubjects } from "@/lib/data";
import { LessonSearchTest } from "@/components/lesson-search-test";
import { AiDiagnostics } from "@/components/ai-diagnostics";

export const maxDuration = 60;

export default async function AdminAiPage() {
  await requireAdmin();
  const subjects = await getAllSubjects();
  const { t } = await getT();
  return (
    <div className="space-y-4">
      <h2 className="tech text-sm font-semibold">{t("admin.aiMenu")}</h2>
      <p className="text-sm text-muted">{t("admin.aiDesc")}</p>
      <AiDiagnostics />
      <LessonSearchTest subjects={subjects.map((x) => x.code)} />
    </div>
  );
}
