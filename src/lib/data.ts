import { cache } from "react";
import { getCatalog } from "@/lib/catalog";
import { ENGLISH_CODE, SLOTS } from "@/lib/constants";
import { nowHM } from "@/lib/dates";
import { MULTI_SPACE } from "@/lib/flags";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Profile, ScheduleSession, Subject } from "@/lib/types";

/** مواد السداسي الحالي (من الكتالوج المخزَّن مؤقتاً، بلا استعلام لكل طلب) */
export const getCurrentSubjects = cache(async (): Promise<Subject[]> => {
  const { semesters, subjects } = await getCatalog();
  const current = semesters.find((s) => s.is_current);
  return current ? subjects.filter((s) => s.semester_id === current.id) : [];
});

/**
 * المواد المتبقية من L1 للطالب الحالي (يضيفها مشرف فضائه). RLS يعيد صفوفه هو فقط، ومحتواها للقراءة فقط.
 * غير الطلاب ← قائمة فارغة.
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

/** مواد السداسي الحالي + المتبقية (للجدول والرئيسية: أسماء المواد وألوانها) */
export const getScheduleSubjects = cache(async (): Promise<Subject[]> => {
  const [current, remaining] = await Promise.all([getCurrentSubjects(), getRemainingSubjects()]);
  const have = new Set(current.map((s) => s.id));
  return [...current, ...remaining.filter((s) => !have.has(s.id))];
});

/** تاريخ بداية السداسي الحالي (YYYY-MM-DD) أو null — يُقرأ مباشرة (طازجاً) لا من الكتالوج المخزَّن ساعة */
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

/** كل المواد مرتبة حسب الفصل ثم الترتيب (لنماذج المشرف) */
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

/** مجموعة الإنجليزية: لا نُخفي حصة إلا إذا اختار الطالب مجموعة مختلفة عن مجموعة الحصة */
export function visibleForGroup(
  session: Pick<ScheduleSession, "group_label">,
  subjectCode: string | undefined,
  profile: Pick<Profile, "english_group">
): boolean {
  if (subjectCode !== ENGLISH_CODE) return true;
  if (!session.group_label || !profile.english_group) return true;
  return session.group_label.trim().toLowerCase() === profile.english_group.trim().toLowerCase();
}

/** هل انتهت الحصة (تاريخها مضى، أو اليوم ووقت نهاية فترتها مضى)؟ */
export function hasEnded(session: Pick<ScheduleSession, "session_date" | "slot">, today: string, now = nowHM()): boolean {
  if (session.session_date < today) return true;
  if (session.session_date > today) return false;
  const slot = SLOTS.find((s) => s.n === session.slot);
  return slot ? slot.end <= now : false;
}
