"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { getUserId } from "@/lib/auth";
import type { FormState } from "./auth";

export async function updatePreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getT();
  const userId = await getUserId();
  if (!userId) return { error: t("common.error") };
  const supabase = await createClient();

  const group = String(formData.get("english_group") ?? "").trim().slice(0, 40);
  const { error } = await supabase
    .from("profiles")
    .update({
      english_group: group || null,
      hide_from_ranking: formData.get("hide_from_ranking") === "on",
    })
    .eq("id", userId);
  if (error) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}
