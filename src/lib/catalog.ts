import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import type { Subject } from "@/lib/types";

export interface Semester {
  id: string;
  code: string;
  name: string;
  is_current: boolean;
  cohort_id?: string;
}

export interface Catalog {
  semesters: Semester[];
  subjects: Subject[];
}

/** مدة بقاء الكتالوج في الذاكرة المؤقتة (ثانية). المواد والفصول لا تتغير إلا نادراً. */
const CATALOG_TTL = 3600;

/**
 * نسخة في ذاكرة Next المؤقتة لكل فضاء (cohort) على حدة: المفتاح يتضمن معرّف الفضاء،
 * فلا يمكن أن يرى طالب مواد فضاء آخر. تستعمل service role لأن unstable_cache لا تقرأ cookies،
 * ومعرّف الفضاء يأتي من ملف المستخدم على الخادم (لا من أي مدخل من العميل).
 * cohortId = null ← كل الفضاءات (للمهام الدورية cron فقط).
 */
const fetchSpaceCatalog = unstable_cache(
  async (cohortId: string | null): Promise<Catalog> => {
    const admin = createAdminClient();
    let semQ = admin.from("semesters").select("id, code, name, is_current, cohort_id");
    let subQ = admin.from("subjects").select("*").order("sort");
    if (cohortId) {
      semQ = semQ.eq("cohort_id", cohortId);
      subQ = subQ.eq("cohort_id", cohortId);
    }
    const [sem, sub] = await Promise.all([semQ, subQ]);
    // الخطأ يُرمى فلا يُخزَّن نتيجة فارغة بالخطأ
    if (sem.error) throw new Error(`semesters: ${sem.error.message}`);
    if (sub.error) throw new Error(`subjects: ${sub.error.message}`);
    return { semesters: sem.data as Semester[], subjects: sub.data as Subject[] };
  },
  ["catalog-v2"],
  { revalidate: CATALOG_TTL, tags: ["catalog"] }
);

async function loadCatalog(cohortId: string | null): Promise<Catalog> {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      return await fetchSpaceCatalog(cohortId);
    } catch (e) {
      console.error("catalog cache failed, falling back to direct query:", e);
    }
  }
  const supabase = await createClient();
  const [sem, sub] = await Promise.all([
    supabase.from("semesters").select("id, code, name, is_current, cohort_id"),
    supabase.from("subjects").select("*").order("sort"),
  ]);
  // RLS يحصر النتيجة في فضاء المستخدم أصلاً
  return { semesters: (sem.data ?? []) as Semester[], subjects: (sub.data ?? []) as Subject[] };
}

/** كتالوج فضاء المستخدم الحالي (الفصول والمواد). */
export const getCatalog = cache(async (): Promise<Catalog> => {
  const profile = await getProfile();
  if (!profile?.cohort_id) return { semesters: [], subjects: [] };
  return loadCatalog(profile.cohort_id);
});

/** كتالوج كل الفضاءات — للمهام الدورية على الخادم فقط (لا يُستعمل في صفحات المستخدم). */
export const getAllSpacesCatalog = cache(async (): Promise<Catalog> => loadCatalog(null));
