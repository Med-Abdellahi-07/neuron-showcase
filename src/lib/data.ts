import { cache } from "react";
import { getCatalog } from "@/lib/catalog";
import { ENGLISH_CODE, SLOTS } from "@/lib/constants";
import { nowHM } from "@/lib/dates";
import { MULTI_SPACE } from "@/lib/flags";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile, ScheduleSession, Subject } from "@/lib/types";

/** Current semester subjects (from the cached catalog, no per-request query). */
export const getCurrentSubjects = cache(async (): Promise<Subject[]> => {
  const { semesters, subjects } = await getCatalog();
  const current = semesters.find((s) => s.is_current);
  return current ? subjects.filter((s) => s.semester_id === current.id) : [];
});

/**
 * Remaining L1 subjects for the current student (added by their space's admin). RLS returns only their own rows, and the content is read-only.
 * Non-students -> empty list.
 */
export const getRemainingSubjects = cache(async (): Promise<Subject[]> => {
  const profile = await getProfile();
  if (!MULTI_SPACE || !profile || profile.role !== "student") return [];
  const supabase = await createClient();
  const { data, error } = await supabase.from("remaining_subjects").select("subjects(*)").eq("student_id", profile.id);
  if (error) {
    console.error("remaining_subjects failed:", error.code, error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as { subjects: Subject | Subject[] | null }[];
  return rows
    .map((r) => (Array.isArray(r.subjects) ? r.subjects[0] : r.subjects))
    .filter((s): s is Subject => !!s)
    .sort((a, b) => a.code.localeCompare(b.code));
});

/** Current semester subjects + remaining ones (for the timetable and home: subject names and colors). */
export const getScheduleSubjects = cache(async (): Promise<Subject[]> => {
  const [current, remaining] = await Promise.all([getCurrentSubjects(), getRemainingSubjects()]);
  const have = new Set(current.map((s) => s.id));
  return [...current, ...remaining.filter((s) => !have.has(s.id))];
});

/** Current semester start date (YYYY-MM-DD) or null; read directly (fresh), not from the catalog cached for an hour. */
export const getSemesterStart = cache(async (): Promise<{ id: string; start: string | null } | null> => {
  const supabase = await createClient();
  const profile = await getProfile();
  if (!profile?.cohort_id) return null;
  const { data } = await supabase
    .from("semesters")
    .select("id, start_date")
    .eq("cohort_id", profile.cohort_id)
    .eq("is_current", true)
    .maybeSingle();
  return data ? { id: data.id as string, start: (data.start_date as string | null) ?? null } : null;
});

/** All subjects ordered by semester then order (for admin forms). */
export const getAllSubjects = cache(async (): Promise<Subject[]> => {
  const { semesters, subjects } = await getCatalog();
  const code = new Map(semesters.map((s) => [s.id, s.code]));
  return [...subjects].sort(
    (a, b) => (code.get(a.semester_id) ?? "").localeCompare(code.get(b.semester_id) ?? "") || a.sort - b.sort
  );
});

export async function getSubjectById(id: string): Promise<Subject | null> {
  const { subjects } = await getCatalog();
  return subjects.find((s) => s.id === id) ?? (await getRemainingSubjects()).find((s) => s.id === id) ?? null;
}

export async function getSubjectByCode(code: string): Promise<Subject | null> {
  const { subjects } = await getCatalog();
  return subjects.find((s) => s.code === code) ?? (await getRemainingSubjects()).find((s) => s.code === code) ?? null;
}

/** English group: a session is hidden only if the student chose a group different from the session's group. */
export function visibleForGroup(
  session: Pick<ScheduleSession, "group_label">,
  subjectCode: string | undefined,
  profile: Pick<Profile, "english_group">
): boolean {
  if (subjectCode !== ENGLISH_CODE) return true;
  if (!session.group_label || !profile.english_group) return true;
  return session.group_label.trim().toLowerCase() === profile.english_group.trim().toLowerCase();
}

/** Has the session ended (its date has passed, or it is today and its slot's end time has passed)? */
export function hasEnded(session: Pick<ScheduleSession, "session_date" | "slot">, today: string, now = nowHM()): boolean {
  if (session.session_date < today) return true;
  if (session.session_date > today) return false;
  const slot = SLOTS.find((s) => s.n === session.slot);
  return slot ? slot.end <= now : false;
}
