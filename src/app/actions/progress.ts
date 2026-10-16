"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function toggleStudied(lessonId: string, studied: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (studied) {
    await supabase.from("lesson_progress").upsert({ user_id: user.id, lesson_id: lessonId });
  } else {
    await supabase.from("lesson_progress").delete().eq("user_id", user.id).eq("lesson_id", lessonId);
  }
  revalidatePath("/", "layout");
}
