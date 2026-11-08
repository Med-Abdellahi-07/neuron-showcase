"use server";

import { MULTI_SPACE } from "@/lib/flags";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { FEATURES } from "@/lib/spaces";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Super admin: "enter" a space (it becomes their current space with that space's admin permissions). */
export async function switchSpace(fd: FormData) {
  if (!MULTI_SPACE) return;
  const me = await requireAdmin();
  const id = text(fd, "cohort_id");
  if (!UUID_RE.test(id)) return;
  const admin = createAdminClient();
  const { data } = await admin.from("cohorts").select("id").eq("id", id).maybeSingle();
  if (!data) return;
  await admin.from("profiles").update({ cohort_id: id }).eq("id", me.id);
  revalidatePath("/", "layout");
  redirect("/");
}

/** Super admin: enable/disable a space. */
export async function setSpaceActive(fd: FormData) {
  if (!MULTI_SPACE) return;
  await requireAdmin();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  await createAdminClient().from("cohorts").update({ is_active: text(fd, "value") === "1" }).eq("id", id);
  revalidatePath("/admin/spaces");
}

/** Super admin: change the plan (copies the template flags). */
export async function setSpacePlan(fd: FormData) {
  if (!MULTI_SPACE) return;
  await requireAdmin();
  const id = text(fd, "id");
  const plan = text(fd, "plan");
  if (!UUID_RE.test(id) || !["full", "basic"].includes(plan)) return;
  const admin = createAdminClient();
  const { data: tpl } = await admin.from("plans").select("features").eq("code", plan).maybeSingle();
  if (!tpl) return;
  await admin.from("cohorts").update({ plan, features: tpl.features }).eq("id", id);
  revalidatePath("/", "layout");
}

/** Super admin: toggle a single feature for a space (the plan becomes "custom"). */
export async function setSpaceFeature(fd: FormData) {
  if (!MULTI_SPACE) return;
  await requireAdmin();
  const id = text(fd, "id");
  const feature = text(fd, "feature");
  if (!UUID_RE.test(id) || !(FEATURES as readonly string[]).includes(feature)) return;
  const admin = createAdminClient();
  const { data } = await admin.from("cohorts").select("features").eq("id", id).maybeSingle();
  if (!data) return;
  const features = { ...(data.features as Record<string, boolean>), [feature]: text(fd, "value") === "1" };
  await admin.from("cohorts").update({ plan: "custom", features }).eq("id", id);
  revalidatePath("/", "layout");
}
