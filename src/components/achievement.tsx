"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { Medal } from "@/components/clay";
import { useUid } from "@/components/clay/uid";
import { useT } from "@/lib/i18n/client";

/**
 * Achievement screen (VWin.html). Shown on: a new streak milestone, completing the weekly goal (5 study days),
 * or a new duel win. What the student has seen is stored in localStorage so it does not repeat.
 */
const KEY = "neuron-win-seen";
interface Seen { streak?: number; week?: string; wins?: number }
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const read = (): Seen | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Seen) : null;
  } catch {
    return null;
  }
};
const write = (v: Seen) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* not persisted: may repeat on the next visit */
  }
};

export interface AchievementProps {
  name: string;
  /** Streak number if it is a milestone, otherwise null. */
  streakMilestone: number | null;
  streak: number;
  /** Week key (the Monday's date) if its goal is complete, otherwise null. */
  weekGoalKey: string | null;
  goalPct: number;
  wins: number;
}

const CONFETTI: [string, string, string, string, string][] = [
  ["8%", "8px", "14px", "2px", "#FFB547"], ["20%", "10px", "10px", "50%", "#FF6B9A"], ["33%", "8px", "14px", "2px", "#6FE3B5"],
  ["47%", "6px", "16px", "2px", "#FFFFFF"], ["60%", "10px", "10px", "50%", "#FFB547"], ["72%", "8px", "14px", "2px", "#B49CFF"],
  ["85%", "8px", "12px", "2px", "#FF6B9A"], ["93%", "10px", "10px", "50%", "#6FE3B5"], ["14%", "6px", "16px", "2px", "#B49CFF"], ["54%", "8px", "14px", "2px", "#FFB547"],
];
const DELAYS = ["0s", "1.1s", ".4s", "2.2s", "1.6s", ".8s", "2.7s", "3.3s", "3s", "3.8s"];

export function Achievement(p: AchievementProps) {
  const { t } = useT();
  const u = useUid("tr");
  const sig = useSyncExternalStore(
    subscribe,
    () => {
      const seen = read();
      const s = p.streakMilestone !== null && p.streakMilestone !== seen?.streak;
      const g = p.weekGoalKey !== null && p.weekGoalKey !== seen?.week;
      const d = seen?.wins !== undefined && p.wins > seen.wins;
      return s || g || d ? `${+s}${+g}${+d}` : "";
    },
    () => "",
  );

  // First visit: record the current win count as the baseline so past wins are not celebrated.
  useEffect(() => {
    if (!read()) write({ wins: p.wins });
  }, [p.wins]);

  if (!sig) return null;
  const [s, g, d] = [sig[0] === "1", sig[1] === "1", sig[2] === "1"];
  const close = () => {
    const seen = read() ?? {};
    write({ streak: p.streakMilestone ?? seen.streak, week: p.weekGoalKey ?? seen.week, wins: p.wins });
    listeners.forEach((l) => l());
  };
  const parts = [
    g ? t("win.goals").replace("{n}", String(p.goalPct)) : null,
    s ? t("win.streak").replace("{n}", String(p.streak)) : null,
    d ? t("win.duels").replace("{n}", String(p.wins)) : null,
  ].filter(Boolean);

  return (
    <div role="dialog" aria-modal="true" aria-label={t("win.title").replace("{name}", p.name)} className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-[22px] overflow-hidden bg-celebrate px-7 text-white">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {CONFETTI.map(([left, w, h, r, bg], i) => (
          <span key={i} className="cf2" style={{ left, width: w, height: h, borderRadius: r, background: bg, animationDelay: DELAYS[i] }} />
        ))}
      </div>

      <div className="relative flex h-[230px] w-60 items-center justify-center">
        <div className="halo absolute size-[230px] rounded-full bg-[#5A35D6]" />
        <svg className="trophy" width="170" height="190" viewBox="0 0 170 190" role="img" aria-label={t("win.trophy")}>
          <defs>
            <radialGradient id={`${u}C`} cx="35%" cy="25%" r="85%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="0.5" stopColor="#FFC24A" /><stop offset="1" stopColor="#D98A12" /></radialGradient>
            <radialGradient id={`${u}B`} cx="40%" cy="20%" r="90%"><stop offset="0" stopColor="#8D6BFF" /><stop offset="1" stopColor="#3B1AA6" /></radialGradient>
          </defs>
          <path d="M38 34 C10 34 8 74 44 82" fill="none" stroke="#E9A42A" strokeWidth="10" strokeLinecap="round" />
          <path d="M132 34 C160 34 162 74 126 82" fill="none" stroke="#E9A42A" strokeWidth="10" strokeLinecap="round" />
          <path d="M36 20 H134 V58 C134 92 112 112 85 112 C58 112 36 92 36 58 Z" fill={`url(#${u}C)`} />
          <ellipse cx="85" cy="20" rx="49" ry="8" fill="#FFE08A" />
          <path d="M85 44 l6 12 13 2 -9.5 9 2.3 13 -11.8-6.2 -11.8 6.2 2.3-13 -9.5-9 13-2z" fill="#FFF6D6" />
          <rect x="74" y="110" width="22" height="26" rx="4" fill="#E9A42A" />
          <rect x="44" y="136" width="82" height="36" rx="12" fill={`url(#${u}B)`} />
          <rect x="60" y="146" width="50" height="8" rx="4" fill="#C4B2FF" opacity="0.7" />
        </svg>
      </div>

      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="m-0 text-[30px] font-bold" dir="auto">{t("win.title").replace("{name}", p.name)}</h1>
        <p className="m-0 text-[15px] leading-[1.7] text-on-dark-3">{parts.join(" · ")}</p>
      </div>

      <div className="flex gap-3.5">
        {p.streak >= 3 ? <Medal kind="streak" value={p.streak} label={t("win.medalStreak").replace("{n}", String(p.streak))} className="med" /> : <Medal kind="locked" label={t("win.medalLocked")} />}
        {p.wins > 0 ? <Medal kind="duel" label={t("win.medalDuel")} className="med" style={{ animationDelay: ".5s" }} /> : <Medal kind="locked" label={t("win.medalLocked")} />}
        {p.weekGoalKey !== null ? <Medal kind="goals" label={t("win.medalGoals")} className="med" style={{ animationDelay: "1s" }} /> : <Medal kind="locked" label={t("win.medalLocked")} />}
        <Medal kind="locked" label={t("win.medalLocked")} />
      </div>

      <Link href="/progress" onClick={close} className="flex h-[54px] w-full items-center justify-center rounded-[18px] bg-white text-base font-semibold text-deep no-underline">
        {t("win.viewAchievements")}
      </Link>
      <button type="button" onClick={close} className="border-0 bg-transparent font-[inherit] text-[13px] text-on-dark">{t("win.continue")}</button>
    </div>
  );
}
