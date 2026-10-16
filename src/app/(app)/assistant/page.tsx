import { Bot } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";

export default async function AssistantPage() {
  await requireUserId();
  const { t } = await getT();
  return (
    <div>
      <h1 className="page-title">{t("assistant.title")}</h1>
      <div className="card flex items-start gap-3">
        <Bot size={22} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p className="text-sm leading-7 text-muted">{t("assistant.soon")}</p>
      </div>
    </div>
  );
}
