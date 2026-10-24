"use client";

import { ActionForm } from "@/components/action-form";
import { useT } from "@/lib/i18n/client";
import { setSpaceAi } from "@/app/actions/ai-admin";

const FLAGS = ["ai_chat", "ai_summary", "ai_qcm", "ai_duel", "ai_tools", "ai_exam"] as const;

export interface SpaceAi {
  id: string;
  name: string;
  planAi: boolean;
  flags: Record<(typeof FLAGS)[number], boolean>;
  today: number;
  week: number;
  usersToday: number;
}

/** صف تحكم بفضاء واحد: الأعلام ونقاطه اليومية، واستهلاكه اليوم وخلال 7 أيام */
export function AiSpaceRow({ s }: { s: SpaceAi }) {
  const { t } = useT();
  return (
    <li className="card space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="tech text-sm font-semibold" dir="ltr">{s.name}</h3>
        <p className="tech text-xs text-muted" dir="ltr">
          {t("aiadm.today")}: {s.today} {t("aiadm.requests")} · {t("aiadm.week")}: {s.week} · {s.usersToday} {t("aiadm.users")}
        </p>
      </div>
      {!s.planAi && <p role="status" className="text-xs text-warn">{t("aiadm.planOff")}</p>}
      <ActionForm action={setSpaceAi} submitLabel={t("common.save")} className="space-y-3" submitClassName="btn btn-sm btn-primary">
        <input type="hidden" name="cohort" value={s.id} />
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {FLAGS.map((f) => (
            <label key={f} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name={f} defaultChecked={s.flags[f]} /> {t(`aiadm.flag.${f}`)}
            </label>
          ))}
        </div>
      </ActionForm>
    </li>
  );
}
