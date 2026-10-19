import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, Clock, Swords } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjectById } from "@/lib/data";
import { Rich } from "@/components/rich";
import { DuelRunner } from "@/components/duel-runner";
import { hoursLeft, type DuelItem, type DuelResult } from "@/lib/duel";
import { requireFeature } from "@/lib/spaces";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERS = ["A", "B", "C", "D", "E", "F"];

export default async function DuelDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUserId();
  await requireFeature("duel");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: resData, error }, { data: listData }] = await Promise.all([supabase.rpc("duel_result", { p_duel: id }), supabase.rpc("my_duels")]);
  if (error || !resData) notFound();
  const res = resData as DuelResult;
  const item = ((listData ?? []) as DuelItem[]).find((d) => d.id === id);
  if (!item || res.status === "cancelled") notFound();
  const subject = item.subject_id ? await getSubjectById(item.subject_id) : null;

  const Head = (
    <div>
      <Link href="/practice/duel" className="text-sm text-accent hover:underline">{t("duel.tab")}</Link>
      <h1 className="page-title !mb-0 mt-1 flex items-center gap-2" dir="auto">
        <Swords size={22} aria-hidden className="text-accent" /> {t("duel.vs")} {item.opponent_name}
      </h1>
      {subject && <p className="tech text-sm text-muted" dir="ltr">{subject.code}</p>}
    </div>
  );

  // ───────── انتهى التحدي: المقارنة والإجابات الصحيحة ─────────
  if ((res.status === "completed" || res.status === "expired") && res.players && res.questions) {
    const me = res.players.find((p) => p.user_id === res.me);
    const other = res.players.find((p) => p.user_id !== res.me);
    const n = res.questions.length;
    const outcome = res.is_draw ? "draw" : res.winner_id === res.me ? "won" : "lost";
    const names = new Map(res.players.map((p) => [p.user_id, p.name]));
    return (
      <div className="space-y-5">
        {Head}
        <section className={`card space-y-1 text-center ${outcome === "won" ? "border-accent" : ""}`} role="status">
          <p className="text-2xl font-semibold">{t(`duel.${outcome}Banner` as "duel.wonBanner")}</p>
          {res.status === "expired" && <p className="text-sm text-muted">{t("duel.expiredNote")}</p>}
        </section>

        <section className="card overflow-x-auto !p-0" aria-label={t("duel.compare")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted">
                <th className="p-3 text-start font-medium" />
                <th className="p-3 text-center font-semibold text-accent">{t("duel.you")}</th>
                <th className="p-3 text-center font-semibold" dir="auto">{other?.name}</th>
              </tr>
            </thead>
            <tbody className="tech">
              {[
                [t("duel.points"), me?.points.toFixed(1), other?.finished ? other.points.toFixed(1) : "—"],
                [t("duel.correct"), `${me?.correct ?? 0}/${n}`, other?.finished ? `${other.correct}/${n}` : "—"],
                [t("duel.time"), me?.finished ? `${Math.round((me.total_ms ?? 0) / 1000)}s` : "—", other?.finished ? `${Math.round(other.total_ms / 1000)}s` : "—"],
              ].map(([label, a, b]) => (
                <tr key={label} className="border-b border-border last:border-0">
                  <td className="p-3 text-start font-sans text-muted">{label}</td>
                  <td className="p-3 text-center" dir="ltr">{a}</td>
                  <td className="p-3 text-center" dir="ltr">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="space-y-3" aria-label={t("duel.review")}>
          <h2 className="tech text-sm font-semibold">{t("duel.review")}</h2>
          {res.questions.map((q, qi) => {
            const mine = q.answers?.find((a) => a.user_id === res.me);
            const theirs = q.answers?.find((a) => a.user_id !== res.me);
            return (
              <article key={q.id} className="card space-y-3">
                <div className="flex gap-2">
                  <span className="tech text-muted" dir="ltr">{qi + 1}.</span>
                  <Rich>{q.statement}</Rich>
                </div>
                <ul className="space-y-1.5">
                  {q.options.map((o, i) => (
                    <li
                      key={i}
                      className={`flex items-start gap-2 rounded-[var(--radius)] border p-2 text-sm ${
                        i === q.correct_index ? "border-success bg-success/10" : "border-border"
                      }`}
                    >
                      <span className="tech shrink-0 font-semibold" dir="ltr">{LETTERS[i]}</span>
                      <span className="min-w-0 flex-1" dir="auto"><Rich>{o}</Rich></span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        {i === q.correct_index && <Check size={14} className="text-success" aria-label={t("duel.correctAnswer")} />}
                        {mine?.selected_index === i && <span className="badge badge-accent">{t("duel.you")}</span>}
                        {theirs?.selected_index === i && <span className="badge" dir="auto">{names.get(theirs.user_id)?.split(" ")[0]}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
                {q.explanation && (
                  <div className="rounded-[var(--radius)] bg-surface-2 p-3 text-sm">
                    <Rich>{q.explanation}</Rich>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      </div>
    );
  }

  const myTurn = (res.status === "challenger_turn" && res.i_am_challenger) || (res.status === "open" && !res.i_am_challenger && !res.my_finished);

  // ───────── دوري الآن ─────────
  if (myTurn)
    return (
      <div className="space-y-5">
        {Head}
        {res.status === "open" && !res.i_am_challenger && (
          <p className="card flex items-center gap-2 text-sm"><Clock size={16} aria-hidden /> {t("duel.hoursLeft")}: <span className="tech">{hoursLeft(res.expires_at)}h</span></p>
        )}
        <DuelRunner duelId={id} total={item.total} />
      </div>
    );

  // ───────── انتظار ─────────
  return (
    <div className="space-y-5">
      {Head}
      <section className="card space-y-2 text-center" role="status">
        <p className="font-semibold">
          {res.status === "challenger_turn" ? t("duel.notReady") : res.my_finished ? t("duel.savedWaiting") : t("duel.waitingBadge")}
        </p>
        {res.status === "open" && (
          <p className="text-sm text-muted">{t("duel.hoursLeft")}: <span className="tech">{hoursLeft(res.expires_at)}h</span> — {t("duel.hiddenUntilDone")}</p>
        )}
      </section>
    </div>
  );
}
