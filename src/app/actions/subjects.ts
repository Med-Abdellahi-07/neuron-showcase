"use server";

import { revalidatePath, updateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const num = (fd: FormData, k: string) => Math.min(999, Math.max(0, parseInt(text(fd, k), 10) || 0));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fields(fd: FormData) {
  return {
    code: text(fd, "code").toUpperCase().replace(/\s+/g, "").slice(0, 20),
    name: text(fd, "name").slice(0, 160),
    credits: num(fd, "credits"),
    cm_hours: num(fd, "cm_hours"),
    td_hours: num(fd, "td_hours"),
    tp_hours: num(fd, "tp_hours"),
    sort: num(fd, "sort"),
  };
}

/** مدير الفضاء: إضافة مادة إلى سداسي فضائه (RLS يمنع أي سداسي آخر). */
export async function createSubject(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireManager();
  const { t } = await getT();
  const semester_id = text(fd, "semester_id");
  const f = fields(fd);
  if (!UUID_RE.test(semester_id) || !f.code || !f.name) return { error: t("common.error") };
  const supabase = await createClient();
  const { error } = await supabase.from("subjects").insert({ semester_id, ...f });
  if (error) return { error: error.code === "23505" ? t("content.exists") : t("common.error") };
  updateTag("catalog");
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}

export async function updateSubject(fd: FormData) {
  await requireManager();
  const id = text(fd, "id");
  const f = fields(fd);
  if (!UUID_RE.test(id) || !f.code || !f.name) return;
  const supabase = await createClient();
  await supabase.from("subjects").update(f).eq("id", id);
  updateTag("catalog");
  revalidatePath("/", "layout");
}

/** حذف مادة يحذف دروسها وأسئلتها (cascade) — يطلب الواجهة تأكيداً. */
export async function deleteSubject(fd: FormData) {
  await requireManager();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("subjects").delete().eq("id", id);
  updateTag("catalog");
  revalidatePath("/", "layout");
}
