import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getAiBalance } from "@/lib/ai/access";
import { AiSpaceRow, type SpaceAi } from "@/components/ai-space-row";

interface Usage { cohort_id: string; day: string; points: number; users: number }

/** لوحة المشرف العام: أعلام الذكاء الاصطناعي لكل فضاء، حصة النقاط اليومية، واستهلاك كل فضاء. */
export async function AiControl() {
  const { t } = await getT();
  const supabase = await createClient();
  const [spaces, usage, bal] = await Promise.all([
    supabase.from("cohorts").select("id, name, features, ai_features, ai_daily_points, is_active").not("major_id", "is", null).order("name"),
    supabase.rpc("ai_space_usage", { p_days: 7 }),
    getAiBalance(),
  ]);
  if (spaces.error || usage.error) return <p className="card text-sm text-warn">{t("aiadm.runMigration")}</p>;
  const today = new Date().toISOString().slice(0, 10);
  const u = (usage.data ?? []) as Usage[];
  const rows: SpaceAi[] = (spaces.data ?? []).map((c) => {
    const mine = u.filter((x) => x.cohort_id === c.id);
    const f = (c.ai_features ?? {}) as Record<string, boolean>;
    return {
      id: c.id as string,
      name: c.name as string,
      planAi: (c.features as Record<string, boolean> | null)?.ai === true,
      flags: { ai_chat: f.ai_chat === true, ai_summary: f.ai_summary === true, ai_qcm: f.ai_qcm === true, ai_duel: f.ai_duel === true, ai_tools: f.ai_tools === true },
      points: c.ai_daily_points as number,
      today: Number(mine.find((x) => x.day === today)?.points ?? 0),
      week: mine.reduce((a, x) => a + Number(x.points), 0),
      usersToday: Number(mine.find((x) => x.day === today)?.users ?? 0),
    };
  });
  const pressure = bal?.pressure ?? 1;
  return (
    <section className="space-y-3" aria-labelledby="aictl-h">
      <h2 id="aictl-h" className="tech text-sm font-semibold">{t("aiadm.title")}</h2>
      <p className="text-sm text-muted">{t("aiadm.desc")}</p>
      <p role="status" className={`rounded-xl p-3 text-sm ${pressure < 1 ? "bg-urgent-bg text-urgent" : "bg-surface-2 text-muted"}`}>
        {pressure < 1 ? t("aiadm.pressureOn").replace("{p}", String(Math.round(pressure * 100))) : t("aiadm.pressureOff")}
      </p>
      <ul className="space-y-3">{rows.map((r) => <AiSpaceRow key={r.id} s={r} />)}</ul>
    </section>
  );
}
