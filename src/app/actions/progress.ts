"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";

export async function toggleStudied(lessonId: string, studied: boolean) {
  const userId = await getUserId();
  if (!userId) return;
  const supabase = await createClient();
  if (studied) {
    await supabase.from("lesson_progress").upsert({ user_id: userId, lesson_id: lessonId });
  } else {
    await supabase.from("lesson_progress").delete().eq("user_id", userId).eq("lesson_id", lessonId);
  }
  revalidatePath("/", "layout");
}
