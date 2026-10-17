import Link from "next/link";
import { Hourglass, Swords, Trophy } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { PracticeTabs } from "@/components/practice-tabs";
import { DuelCreate, type DuelLesson } from "@/components/duel-create";
import { hoursLeft, type DuelItem } from "@/lib/duel";
import type { DictKey } from "@/lib/i18n/dictionaries";

interface RecordRow {
  user_id: string;
  full_name: string;
  wins: number;
  losses: number;
  draws: number;
  is_me: boolean;
}

const ERR: Record<string, DictKey> = {
  duel_exists: "duel.err.exists",
  too_many: "duel.err.tooMany",
  not_enough_questions: "duel.err.notEnough",
  bad_opponent: "duel.err.generic",
  generic: "duel.err.generic",
};

export default async function DuelPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  await requireUserId();
  const { err } = await searchParams;
  const { t } = await getT();
  const supabase = await createClient();
  const subjects = await getCurrentSubjects();

  const [duelsRes, recordRes, matesRes, lessonsRes] = await Promise.all([
    supabase.rpc("my_duels"),
    supabase.rpc("duel_record"),
    supabase.rpc("cohort_mates"),
    supabase.from("lessons").select("id, subject_id, kind, number, title").eq("status", "published").neq("kind", "resume").order("number"),
  ]);
  const duels = (duelsRes.data ?? []) as DuelItem[];
  const record = (recordRes.data ?? []) as RecordRow[];
  const mates = (matesRes.data ?? []) as { id: string; full_name: string }[];
  const subjIds = new Set(subjects.map((s) => s.id));
  const lessons = ((lessonsRes.data ?? []) as DuelLesson[]).filter((l) => subjIds.has(l.subject_id));
  const me = record.find((r) => r.is_me);

  const toPlay = duels.filter((d) => (d.status === "challenger_turn" && d.i_am_challenger) || (d.status === "open" && !d.i_am_challenger && !d.my_finished));
  const waiting = duels.filter((d) => d.status === "open" && d.my_finished);
  const done = duels.filter((d) => d.status === "completed" || d.status === "expired");

  const subjectName = (d: DuelItem) => subjects.find((s) => s.id === d.subject_id)?.code ?? "";

  const row = (d: DuelItem, label: string) => (
    <li key={d.id}>
      <Link href={`/practice/duel/${d.id}`} className="card flex items-center justify-between gap-3 !p-3 transition-colors hover:bg-surface-2">
        <span className="min-w-0">
          <span className="block truncate font-medium" dir="auto">{d.opponent_name}</span>
          <span className="text-xs text-muted">
            {d.status === "open" && d.expires_at ? `${t("duel.hoursLeft")}: ${hoursLeft(d.expires_at)}h` : subjectName(d)}
          </span>
        </span>
        <span className={`badge shrink-0 ${d.result?.won ? "badge-accent" : ""}`}>{label}</span>
      </Link>
    </li>
  );

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0">{t("practice.title")}</h1>
      <PracticeTabs />

      {err && <p role="alert" className="card text-sm text-warn">{t(ERR[err] ?? "duel.err.generic")}</p>}

      <section className="card flex items-center justify-between gap-3" aria-label={t("duel.record")}>
        <span className="tech flex items-center gap-2 text-sm font-semibold"><Trophy size={16} aria-hidden /> {t("duel.record")}</span>
        <span className="tech flex gap-3 text-sm" dir="ltr">
          <span className="text-success">{me?.wins ?? 0} W</span>
          <span className="text-danger">{me?.losses ?? 0} L</span>
          <span className="text-muted">{me?.draws ?? 0} D</span>
        </span>
      </section>

      {toPlay.length > 0 && (
        <section className="space-y-2" aria-labelledby="dp-h">
          <h2 id="dp-h" className="tech flex items-center gap-2 text-sm font-semibold"><Swords size={16} aria-hidden /> {t("duel.toPlay")}</h2>
          <ul className="space-y-2">{toPlay.map((d) => row(d, t(d.status === "challenger_turn" ? "duel.yourTurnStart" : "duel.answerNow")))}</ul>
        </section>
      )}

      <DuelCreate mates={mates} subjects={subjects.map((s) => ({ id: s.id, code: s.code, name: s.name }))} lessons={lessons} />

      {waiting.length > 0 && (
        <section className="space-y-2" aria-labelledby="dw-h">
          <h2 id="dw-h" className="tech flex items-center gap-2 text-sm font-semibold"><Hourglass size={16} aria-hidden /> {t("duel.waiting")}</h2>
          <ul className="space-y-2">{waiting.map((d) => row(d, t("duel.waitingBadge")))}</ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="space-y-2" aria-labelledby="dd-h">
          <h2 id="dd-h" className="tech text-sm font-semibold">{t("duel.finished")}</h2>
          <ul className="space-y-2">
            {done.map((d) => row(d, d.result?.draw ? t("duel.draw") : d.result?.won ? t("duel.won") : t("duel.lost")))}
          </ul>
        </section>
      )}

      {record.length > 0 && (
        <section className="space-y-2" aria-labelledby="drec-h">
          <h2 id="drec-h" className="tech text-sm font-semibold">{t("duel.board")}</h2>
          <p className="text-xs text-muted">{t("duel.boardNote")}</p>
          <ul className="card divide-y divide-border !p-0">
            {record.map((r) => (
              <li key={r.user_id} className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${r.is_me ? "bg-accent-soft" : ""}`}>
                <span className="min-w-0 truncate" dir="auto">{r.full_name}</span>
                <span className="tech flex shrink-0 gap-3" dir="ltr">
                  <span className="text-success">{r.wins}W</span>
                  <span className="text-danger">{r.losses}L</span>
                  <span className="text-muted">{r.draws}D</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
