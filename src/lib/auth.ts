import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * معرّف المستخدم الحالي من الـ JWT عبر getClaims().
 * مع مفاتيح التوقيع غير المتماثلة يتم التحقق محلياً بلا طلب شبكة إلى Supabase Auth
 * (بخلاف getUser() التي تتصل بالخادم في كل مرة). cache() يمنع التكرار داخل الطلب الواحد.
 * الأمان الفعلي للبيانات يظل في RLS لأن auth.uid() تُقرأ من الـ JWT في قاعدة البيانات.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

/** الملف الشخصي: يُقرأ مرة واحدة فقط لكل طلب (Layout والصفحة يشتركان في النتيجة). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, can_publish_direct, cohort_id, locale, english_group, hide_from_ranking")
    .eq("id", userId)
    .maybeSingle();
  // يظهر السبب الحقيقي (مثل permission denied) في سجلات Vercel بدل رسالة عامة فقط
  if (error) console.error("getProfile failed:", error.code, error.message);
  return (data as Profile | null) ?? null;
});

/** للصفحات التي تكفيها هوية المستخدم فقط: بلا قراءة الملف الشخصي من قاعدة البيانات. */
export async function requireUserId(): Promise<string> {
  const id = await getUserId();
  if (!id) redirect("/login");
  return id;
}

export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

export async function requireStaff(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "moderator" && profile.role !== "admin") redirect("/");
  return profile;
}

export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect("/admin");
  return profile;
}
