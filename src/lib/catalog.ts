import { cache } from "react";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Subject } from "@/lib/types";

export interface Semester {
  id: string;
  code: string;
  name: string;
  is_current: boolean;
}

export interface Catalog {
  semesters: Semester[];
  subjects: Subject[];
}

/** مدة بقاء الكتالوج في الذاكرة المؤقتة (ثانية). المواد والفصول لا تتغير إلا نادراً. */
const CATALOG_TTL = 3600;

/**
 * نسخة مشتركة بين كل الطلاب في ذاكرة Next المؤقتة.
 * تستعمل service role لأن دالة unstable_cache لا يمكنها قراءة cookies الطلب،
 * والبيانات نفسها لا تختلف بين المستخدمين (منهج دراسي مقروء لكل مسجّل الدخول).
 * تُستدعى فقط من صفحات خلف تسجيل الدخول (proxy.ts يفرضه).
 */
const fetchSharedCatalog = unstable_cache(
  async (): Promise<Catalog> => {
    const admin = createAdminClient();
    const [sem, sub] = await Promise.all([
      admin.from("semesters").select("id, code, name, is_current"),
      admin.from("subjects").select("*").order("sort"),
    ]);
    // الخطأ يُرمى فلا يُخزَّن نتيجة فارغة بالخطأ
    if (sem.error) throw new Error(`semesters: ${sem.error.message}`);
    if (sub.error) throw new Error(`subjects: ${sub.error.message}`);
    return { semesters: sem.data as Semester[], subjects: sub.data as Subject[] };
  },
  ["catalog-v1"],
  { revalidate: CATALOG_TTL, tags: ["catalog"] }
);

/** كتالوج الفصول والمواد. يُقرأ من الذاكرة المؤقتة، ويرجع للاستعلام المباشر إن تعذّر. */
export const getCatalog = cache(async (): Promise<Catalog> => {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      return await fetchSharedCatalog();
    } catch (e) {
      console.error("catalog cache failed, falling back to direct query:", e);
    }
  }
  const supabase = await createClient();
  const [sem, sub] = await Promise.all([
    supabase.from("semesters").select("id, code, name, is_current"),
    supabase.from("subjects").select("*").order("sort"),
  ]);
  return { semesters: (sem.data ?? []) as Semester[], subjects: (sub.data ?? []) as Subject[] };
});
