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
  // الهاتف قد يُكتب بصيغ مختلفة (+222…، 00222…، بدون مفتاح الدولة): نطابق آخر 8 أرقام.
  if (parsed.phoneTail && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const { data } = await createAdminClient()
      .from("profiles")
      .select("email")
      .like("phone", `%${parsed.phoneTail}`)
      .limit(2);
    if (data && data.length === 1 && data[0].email) email = data[0].email;
  }

  // الفضاء المختار في شاشة الدخول (اختياري: نموذج الاحتياط القديم بلا فضاء)
  const spaceRaw = String(formData.get("space_id") ?? "");
  const spaceId = UUID_RE.test(spaceRaw) ? spaceRaw : null;

  const supabase = await createClient();
  const { data: signIn, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: t("login.invalid") };

  // المستخدم يأتي من نتيجة تسجيل الدخول نفسها — لا حاجة لطلب getUser إضافي
  const user = signIn.user;
  if (user) {
    const { data: profile } = await supabase.from("profiles").select("locale, role, cohort_id").eq("id", user.id).maybeSingle();

    if (spaceId) {
      const { data: space } = await supabase.from("cohorts").select("id, name, is_active").eq("id", spaceId).maybeSingle();
      if (profile?.role === "admin") {
        // المشرف العام يدخل أي فضاء: يصير هو «فضاءه الحالي»
        if (space && process.env.SUPABASE_SERVICE_ROLE_KEY && profile.cohort_id !== spaceId)
          await createAdminClient().from("profiles").update({ cohort_id: spaceId }).eq("id", user.id);
      } else if (!profile || profile.cohort_id !== spaceId) {
        // ليس حسابه في هذا الفضاء: نُنهي الجلسة ونبيّن الفضاء المطلوب
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
  // رسالة موحّدة حتى لا نكشف وجود الحساب
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
