import { getT } from "@/lib/i18n/server";
import type { Status } from "@/lib/types";

export async function StatusBadge({ status }: { status: Status }) {
  const { t } = await getT();
  const cls =
    status === "published" ? "badge-accent" : status === "pending" ? "!text-warn" : "";
  return <span className={`badge ${cls}`}>{t(`status.${status}`)}</span>;
}
