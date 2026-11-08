"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseIdentifier } from "@/lib/identifier";
import { getT } from "@/lib/i18n/server";
import { getUserId } from "@/lib/auth";
import { SPACE_COOKIE } from "@/lib/spaces";
import { MULTI_SPACE } from "@/lib/flags";
import { LOCALES, LOCALE_COOKIE, type Locale } from "@/lib/i18n/dictionaries";

export type FormState = { error?: string; message?: string } | null;

async function writeLocaleCookie(locale: Locale) {
  (await cookies()).set(LOCALE_COOKIE, locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getT();
  const parsed = parseIdentifier(String(formData.get("identifier") ?? ""));
  const password = String(formData.get("password") ?? "");
  if (!parsed || !password) return { error: t("login.invalid") };

  let email = parsed.email;
  // Phones can be typed in many formats (+222..., 00222..., without country code): match the last 8 digits.
  if (parsed.phoneTail && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("email")
      .like("phone", `%${parsed.phoneTail}`)
      .limit(2);
    if (data && data.length === 1 && data[0].email) email = data[0].email;
  }

  // Space chosen on the login screen (optional: the legacy fallback form has none).
  const spaceRaw = String(formData.get("space_id") ?? "");
  const spaceId = UUID_RE.test(spaceRaw) ? spaceRaw : null;

  const supabase = await createClient();
  const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: t("login.invalid") };

  // The user comes from the sign-in result itself, so no extra getUser call is needed.
  const user = signIn.user;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("locale, role, cohort_id").eq("id", user.id).maybeSingle();

    // Single space: anyone other than the super admin must be in IAA L2, otherwise login is refused (the account is not deleted).
    if (!MULTI_SPACE && profile?.role !== "admin") {
      let ok = false;
      if (profile?.cohort_id) {
        const { data: c } = await supabase
          .from("cohorts")
          .select("level_code, majors(code)")
          .eq("id", profile.cohort_id)
          .maybeSingle();
        const major = (c as unknown as { majors: { code: string } | { code: string }[] | null } | null)?.majors;
        const code = Array.isArray(major) ? major[0]?.code : major?.code;
        ok = c?.level_code === "L2" && code === "IAA";
      }
      if (!ok) {
        await supabase.auth.signOut();
        return { error: t("login.iaaOnly") };
      }
    }

    if (MULTI_SPACE && spaceId) {
      const { data: space } = await supabase.from("cohorts").select("id, name, is_active").eq("id", spaceId).maybeSingle();
      if (profile?.role === "admin") {
        // The super admin can enter any space, which becomes their current space.
        if (space && process.env.SUPABASE_SERVICE_ROLE_KEY && profile.cohort_id !== spaceId)
          await createAdminClient().from("profiles").update({ cohort_id: spaceId }).eq("id", user.id);
      } else if (!profile || profile.cohort_id !== spaceId) {
        // The account does not belong to this space: end the session and name the required space.
        await supabase.auth.signOut();
        let label = "";
        if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
          const { data } = await createAdminClient().from("cohorts").select("name").eq("id", spaceId).maybeSingle();
          label = (data?.name as string | undefined) ?? "";
        }
        return { error: t("login.wrongSpace").replace("{space}", label) };
      }
      (await cookies()).set(SPACE_COOKIE, spaceId, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", httpOnly: true });
    }

    if (profile?.locale && LOCALES.includes(profile.locale as Locale)) {
      await writeLocaleCookie(profile.locale as Locale);
    }
  }
  redirect("/");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestReset(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getT();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (email.includes("@")) {
    const h = await headers();
    const origin = h.get("origin") ?? `https://${h.get("host")}`;
    const supabase = await createClient();
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });
  }
  // Uniform response so account existence is not revealed.
  return { message: t("forgot.sent") };
}

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  await writeLocaleCookie(locale);
  const userId = await getUserId();
  if (userId) {
    const supabase = await createClient();
    await supabase.from("profiles").update({ locale }).eq("id", userId);
  }
  revalidatePath("/", "layout");
}
