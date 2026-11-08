"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, requireManager } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { parseIdentifier } from "@/lib/identifier";
import { notifyAnnouncement } from "@/lib/notify";
import { isValidISO } from "@/lib/dates";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Announcements.

export async function createAnnouncement(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireManager();
  const { t } = await getT();
  // The space comes from the creator's profile on the server, not from the form (RLS checks it too).
  const cohort_id = me.cohort_id ?? "";
  const title = text(fd, "title");
  if (!UUID_RE.test(cohort_id) || !title) return { error: t("common.error") };
  // Expiry date is optional: the announcement stays visible until the end of that day (UTC).
  const exp = text(fd, "expires_on");
  if (exp && !isValidISO(exp)) return { error: t("common.error") };
  const supabase = await createClient();
  const { error } = await supabase.from("announcements").insert({
    cohort_id,
    title: title.slice(0, 200),
    body: text(fd, "body").slice(0, 4000),
    pinned: fd.get("pinned") === "on",
    expires_at: exp ? `${exp}T23:59:59Z` : null,
  });
  if (error) return { error: t("common.error") };
  if (fd.get("notify") === "on") notifyAnnouncement(cohort_id, title.slice(0, 120), text(fd, "body"));
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}

export async function deleteAnnouncement(fd: FormData) {
  await requireManager();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("announcements").delete().eq("id", id);
  revalidatePath("/", "layout");
}

// Batches and accounts.

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
  if (!["student", "moderator", "space_admin", "admin"].includes(role)) return { error: t("common.error") };
  if (cohort_id && !UUID_RE.test(cohort_id)) return { error: t("common.error") };
  if (role !== "admin" && !cohort_id) return { error: t("acc.needSpace") };

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
  // The first space admin created activates their space automatically (it then shows on the login screen).
  if (role === "space_admin" && cohort_id) await admin.from("cohorts").update({ is_active: true }).eq("id", cohort_id);
  revalidatePath("/", "layout");
  return { message: t("acc.created") };
}

export async function updateAccount(fd: FormData) {
  const me = await requireAdmin();
  const id = text(fd, "id");
  const role = text(fd, "role");
  const cohort_id = text(fd, "cohort_id");
  if (!UUID_RE.test(id) || !["student", "moderator", "space_admin", "admin"].includes(role)) return;
  if (id === me.id && role !== "admin") return; // An admin cannot demote themselves.
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
  await createAdminClient().auth.admin.deleteUser(id); // Deletes the profile automatically (cascade).
  revalidatePath("/", "layout");
}
