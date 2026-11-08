import type { GridSession } from "../schedule-grid.ts";

export interface OfflineQuestion {
  n: number;
  statement: string;
  options: string[];
  correct: number;
  explanation: string | null;
}
export interface OfflineSummary {
  id: string;
  title: string;
  kind: string;
  content: string;
  cards: { front: string; back: string; page: number | null }[] | null;
}
export interface OfflinePdf {
  name: string;
  blob: Blob;
}
/** A lesson pack saved on the device. */
export interface OfflinePack {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  /** Subject code (for grouping on the local page); may be missing in old packs. */
  subjectCode?: string;
  savedAt: number;
  pdfs: OfflinePdf[];
  questions: OfflineQuestion[];
  summaries: OfflineSummary[];
}
/** What the server returns before the PDF files are fetched. */
export interface PackManifest {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  subjectCode?: string;
  pdfs: { name: string; url: string; parts?: string[]; hashes?: string[] }[];
  questions: OfflineQuestion[];
  summaries: OfflineSummary[];
}
export interface OfflineScore {
  lessonId: string;
  at: number;
  correct: number;
  total: number;
}
/** A result waiting to be sent to the server (practice only, no ranking). */
export interface OutboxScore extends OfflineScore {
  clientId: string;
}

/**
 * The timetable copy saved on every open of the installed app. No email, phone, tokens or conversations:
 * only display name, space name, sessions and subjects.
 */
export interface OfflineSnapshot {
  userId: string;
  name: string;
  space: string;
  locale: "ar" | "fr" | "en";
  /** The app's time zone (to compute day and hour locally). */
  tz: string;
  savedAt: number;
  /** Semester start date for week numbering. */
  semesterStart: string | null;
  /** Monday of the default week (the current one, or the next one on Sunday). */
  defaultMonday: string;
  /** Sessions of the current and next week (with an L1 badge for remaining subjects). */
  sessions: GridSession[];
  /** Remaining L1 subjects. */
  remaining: { id: string; code: string; name: string }[];
  features: { ai: boolean; chat: boolean; ranking: boolean };
}
export interface RecentLesson {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  at: number;
}
