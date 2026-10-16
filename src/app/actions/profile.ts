"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import type { FormState } from "./auth";

export async function updatePreferences(_prev: FormState, formData: FormData): Promise<FormState> {
  const { t } = await getT();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: t("common.error") };

  const group = String(formData.get("english_group") ?? "").trim().slice(0, 40);
  const { error } = await supabase
    .from("profiles")
    .update({
      english_group: group || null,
      hide_from_ranking: formData.get("hide_from_ranking") === "on",
    })
    .eq("id", user.id);
  if (error) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}
