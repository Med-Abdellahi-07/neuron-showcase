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

/** How long the catalog stays in the cache (seconds). Subjects and semesters rarely change. */
const CATALOG_TTL = 3600;

/**
 * A copy in Next's cache per space (cohort): the key includes the space id,
 * so a student can never see another space's subjects. Uses the service role because unstable_cache cannot read cookies,
 * and the space id comes from the user's profile on the server (never from client input).
 * cohortId = null -> all spaces (for cron jobs only).
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
    // Throw the error so an empty result is never cached by mistake.
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
  // RLS already restricts the result to the user's space.
  return { semesters: (sem.data ?? []) as Semester[], subjects: (sub.data ?? []) as Subject[] };
}

/** Catalog of the current user's space (semesters and subjects). */
export const getCatalog = cache(async (): Promise<Catalog> => {
  const profile = await getProfile();
  if (!profile?.cohort_id) return { semesters: [], subjects: [] };
  return loadCatalog(profile.cohort_id);
});

/** Catalog of all spaces: for periodic server jobs only (never used in user pages). */
export const getAllSpacesCatalog = cache(async (): Promise<Catalog> => loadCatalog(null));
