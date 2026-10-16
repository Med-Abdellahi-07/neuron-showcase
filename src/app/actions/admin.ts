"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { parseIdentifier } from "@/lib/identifier";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ───────────── الإعلانات ─────────────

export async function createAnnouncement(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const cohort_id = text(fd, "cohort_id");
  const title = text(fd, "title");
  if (!UUID_RE.test(cohort_id) || !title) return { error: t("common.error") };
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    cohort_id,
    title: title.slice(0, 200),
    body: text(fd, "body").slice(0, 4000),
    pinned: fd.get("pinned") === "on",
  });
  if (error) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}

export async function deleteAnnouncement(fd: FormData) {
  await requireAdmin();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("announcements").delete().eq("id", id);
  revalidatePath("/", "layout");
}

// ───────────── الدفعات والحسابات ─────────────

export async function createCohort(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const name = text(fd, "name");
  if (!name) return { error: t("common.error") };
  const supabase = await createClient();
  const { error } = await supabase.from("cohorts").insert({ name: name.slice(0, 80) });
  if (error) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}

export async function createAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const full_name = text(fd, "full_name");
  const parsed = parseIdentifier(text(fd, "identifier"));
  const password = String(fd.get("password") ?? "");
  const role = text(fd, "role");
  const cohort_id = text(fd, "cohort_id");

  if (!full_name) return { error: t("common.error") };
  if (!parsed) return { error: t("acc.badIdentifier") };
  if (password.length < 8) return { error: t("reset.short") };
  if (!["student", "moderator", "admin"].includes(role)) return { error: t("common.error") };
  if (cohort_id && !UUID_RE.test(cohort_id)) return { error: t("common.error") };

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: parsed.email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });
  if (error || !data.user) {
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return { error: exists ? t("acc.exists") : t("common.error") };
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: full_name.slice(0, 120),
    email: parsed.email,
    phone: parsed.phone,
    role,
    cohort_id: cohort_id || null,
    can_publish_direct: role === "moderator" && fd.get("can_publish_direct") === "on",
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { error: profileError.code === "23505" ? t("acc.exists") : t("common.error") };
  }
  revalidatePath("/", "layout");
  return { message: t("acc.created") };
}

export async function updateAccount(fd: FormData) {
  const me = await requireAdmin();
  const id = text(fd, "id");
  const role = text(fd, "role");
  const cohort_id = text(fd, "cohort_id");
  if (!UUID_RE.test(id) || !["student", "moderator", "admin"].includes(role)) return;
  if (id === me.id && role !== "admin") return; // لا يخفّض المدير نفسه
  const admin = createAdminClient();
  await admin
    .from("profiles")
    .update({
      role,
      cohort_id: UUID_RE.test(cohort_id) ? cohort_id : null,
      can_publish_direct: role === "moderator" && fd.get("can_publish_direct") === "on",
    })
    .eq("id", id);
  revalidatePath("/", "layout");
}

export async function resetPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireAdmin();
  const { t } = await getT();
  const id = text(fd, "id");
  const password = String(fd.get("password") ?? "");
  if (!UUID_RE.test(id)) return { error: t("common.error") };
  if (password.length < 8) return { error: t("reset.short") };
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) return { error: t("common.error") };
  return { message: t("acc.updated") };
}

export async function deleteAccount(fd: FormData) {
  const me = await requireAdmin();
  const id = text(fd, "id");
  if (!UUID_RE.test(id) || id === me.id) return;
  await createAdminClient().auth.admin.deleteUser(id); // يحذف الملف الشخصي تلقائياً (cascade)
  revalidatePath("/", "layout");
}
