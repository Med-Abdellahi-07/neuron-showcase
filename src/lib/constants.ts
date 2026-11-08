export const SLOTS = [
  { n: 1, start: "08:00", end: "09:30" },
  { n: 2, start: "09:30", end: "11:00" },
  { n: 3, start: "11:10", end: "12:40" },
  { n: 4, start: "12:40", end: "14:10" },
  { n: 5, start: "14:10", end: "15:40" },
  { n: 6, start: "15:40", end: "17:10" },
] as const;

/** Study days: Monday (1) to Saturday (6). */
export const STUDY_DAYS = [1, 2, 3, 4, 5, 6] as const;

export const SESSION_KINDS = ["cm", "td", "tp"] as const;
export const LESSON_KINDS = ["cm", "td", "tp", "resume"] as const;

/** Duration of one session in hours. */
export const SESSION_HOURS = 1.5;
export const sessionsFromHours = (hours: number) => Math.round(hours / SESSION_HOURS);

/** Subject code of English (it has groups). */
export const ENGLISH_CODE = "LTR341";
