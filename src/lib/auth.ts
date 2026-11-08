import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/types";

/**
 * Current user id from the JWT via getClaims().
 * With asymmetric signing keys verification is local, with no network request to Supabase Auth
 * (unlike getUser(), which contacts the server every time). cache() prevents repeats within a single request.
 * Actual data security still lives in RLS, because auth.uid() is read from the JWT in the database.
 */
export const getUserId = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  return data.claims.sub;
});

/** The profile: read once per request (the layout and the page share the result). */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const userId = await getUserId();
  if (!userId) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone, role, can_publish_direct, cohort_id, locale, english_group, hide_from_ranking")
    .eq("id", userId)
    .maybeSingle();
  // Surfaces the real cause (such as permission denied) in Vercel logs instead of only a generic message.
  if (error) console.error("getProfile failed:", error.code, error.message);
  return (data as Profile | null) ?? null;
});

/** For pages that only need the user's identity: no profile read from the database. */
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

/** Staff of the current space: moderator, space admin, or the super admin (inside the space they entered). */
export const isStaffRole = (role: Profile["role"]) => role === "moderator" || role === "space_admin" || role === "admin";
/** Space "manager": space admin or super admin. Publishes directly and manages all of the space's content. */
export const isManagerRole = (role: Profile["role"]) => role === "space_admin" || role === "admin";

export async function requireStaff(): Promise<Profile> {
  const profile = await requireProfile();
  if (!isStaffRole(profile.role)) redirect("/");
  return profile;
}

/** Space manager (space admin or super admin). Everything tied to a single space: announcements, assigned questions, semester start, etc. */
export async function requireManager(): Promise<Profile> {
  const profile = await requireProfile();
  if (!isManagerRole(profile.role)) redirect(isStaffRole(profile.role) ? "/admin" : "/");
  return profile;
}

/** Super admin only (managing spaces, cross-space accounts and everything university-wide). */
export async function requireAdmin(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "admin") redirect(isStaffRole(profile.role) ? "/admin" : "/");
  return profile;
}
