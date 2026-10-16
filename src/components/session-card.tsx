import { getT } from "@/lib/i18n/server";
import { SLOTS } from "@/lib/constants";
import type { ScheduleSession, Subject } from "@/lib/types";

export async function SessionCard({
  session,
  subject,
  actions,
}: {
  session: ScheduleSession;
  subject: Subject | undefined;
  actions?: React.ReactNode;
}) {
  const { t } = await getT();
  const slot = SLOTS.find((s) => s.n === session.slot);
  const cancelled = session.status === "cancelled";
  return (
    <li className={`card space-y-1.5 !p-3 ${cancelled ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`font-medium leading-snug ${cancelled ? "line-through" : ""}`} dir="auto">
            {subject?.name ?? "—"}
          </p>
          <p className="tech text-xs text-muted" dir="ltr">
            {slot?.start}–{slot?.end}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <span className="badge badge-accent tech">{t(`kind.${session.kind}`)}</span>
          {session.status === "cancelled" && <span className="badge !text-danger">{t("schedule.cancelled")}</span>}
          {session.status === "changed" && <span className="badge !text-warn">{t("schedule.changed")}</span>}
        </div>
      </div>
      <p className="text-xs text-muted">
        {[
          session.room && `${t("schedule.room")}: ${session.room}`,
          session.teacher && `${t("schedule.teacher")}: ${session.teacher}`,
          session.shared_with && `${t("schedule.sharedWith")}: ${session.shared_with}`,
          session.group_label && `${t("schedule.group")}: ${session.group_label}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {session.note && <p className="text-xs text-warn" dir="auto">{session.note}</p>}
      {actions}
    </li>
  );
}
