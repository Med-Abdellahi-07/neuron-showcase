import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { SPACE_SELECT, toSpace, type Feature, type Space, type SpaceRow } from "@/lib/space-model";

export * from "@/lib/space-model";

/** The current user's space (once per request). Super admin: the space they "entered". */
export const getSpace = cache(async (): Promise<Space | null> => {
  const profile = await getProfile();
  if (!profile?.cohort_id) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("cohorts").select(SPACE_SELECT).eq("id", profile.cohort_id).maybeSingle();
  if (error) console.error("getSpace failed:", error.code, error.message);
  return data ? toSpace(data as unknown as SpaceRow) : null;
});

export async function featureEnabled(feature: Feature): Promise<boolean> {
  return (await getSpace())?.features[feature] === true;
}

/** For pages: feature disabled -> redirect to Home (the page does not render and no queries run). */
export async function requireFeature(feature: Feature): Promise<void> {
  if (!(await featureEnabled(feature))) redirect("/");
}

