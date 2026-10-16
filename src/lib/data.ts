import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { ENGLISH_CODE, SLOTS } from "@/lib/constants";
import { nowHM } from "@/lib/dates";
import type { Profile, ScheduleSession, Subject } from "@/lib/types";

/** مواد السداسي الحالي */
export const getCurrentSubjects = cache(async (): Promise<Subject[]> => {
  const supabase = await createClient();
  const { data: sem } = await supabase.from("semesters").select("id").eq("is_current", true).maybeSingle();
  if (!sem) return [];
  const { data } = await supabase.from("subjects").select("*").eq("semester_id", sem.id).order("sort");
  return (data ?? []) as Subject[];
});

/** كل المواد (لنماذج المشرف) */
export const getAllSubjects = cache(async (): Promise<Subject[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("subjects").select("*").order("semester_id").order("sort");
  return (data ?? []) as Subject[];
});

export async function getSubjectByCode(code: string): Promise<Subject | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("subjects").select("*").eq("code", code).maybeSingle();
  return (data as Subject | null) ?? null;
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
