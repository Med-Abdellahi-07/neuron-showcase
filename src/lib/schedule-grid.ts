import { SLOTS } from "@/lib/constants";
import type { ScheduleSession, Subject } from "@/lib/types";

/** A session as it reaches the timetable grid (plain data, safe to pass to a client component). */
export interface GridSession {
  id: string;
  date: string;
  slot: number;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  kind: "cm" | "td" | "tp";
  room: string | null;
  teacher: string | null;
  sharedWith: string | null;
  groupLabel: string | null;
  status: "scheduled" | "cancelled" | "changed";
  note: string | null;
  /** Subject color index (stable per subject). */
  color: number;
  /** A remaining L1 subject's session (from another space) -> "L1" badge. */
  l1: boolean;
}

/** Color hues (HSL): blue first, then matching colors. Mixed with the surface color so they stay light in both modes. */
export const SUBJECT_HUES = [214, 258, 172, 38, 196, 146, 82, 234, 52, 282] as const;
export const hueOf = (color: number) => SUBJECT_HUES[((color % SUBJECT_HUES.length) + SUBJECT_HUES.length) % SUBJECT_HUES.length];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/**
 * Each subject's color: its position in the current semester's subjects (so no two colors repeat within a semester),
 * and any subject outside it gets a stable color from its code.
 */
export function colorMap(current: Pick<Subject, "id" | "code">[], extra: Pick<Subject, "id" | "code">[] = []): Map<string, number> {
  const m = new Map<string, number>();
  current.forEach((s, i) => m.set(s.id, i));
  for (const s of extra) if (!m.has(s.id)) m.set(s.id, hash(s.code));
  return m;
}

export function toGridSession(s: ScheduleSession, subject: Pick<Subject, "code" | "name"> | undefined, color: number, l1 = false): GridSession {
  return {
    id: s.id,
    date: s.session_date,
    slot: s.slot,
    subjectId: s.subject_id,
    subjectCode: subject?.code ?? "",
    subjectName: subject?.name ?? "—",
    kind: s.kind,
    room: s.room,
    teacher: s.teacher,
    sharedWith: s.shared_with,
    groupLabel: s.group_label,
    status: s.status,
    note: s.note,
    color,
    l1,
  };
}

/** Index of the period happening now (HH:MM); none between periods (such as 11:00-11:10). */
export function slotAt(hm: string): number | null {
  return SLOTS.find((s) => s.start <= hm && hm < s.end)?.n ?? null;
}

export const VIEW_COOKIE = "neuron-sched-view";

/** Saves the student's choice (grid/day) in a cookie the server reads on first paint, so the view does not flicker. */
export function saveView(v: ScheduleView) {
  try {
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* Cookies unavailable: the choice lasts for this visit only. */
  }
}
export type ScheduleView = "grid" | "day";
