"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";

/** يحدّث «آخر ظهور» (الدالة نفسها تتجاهل التكرار خلال 10 دقائق). */
export async function touchSeen(): Promise<void> {
  if (!(await getUserId())) return;
  const supabase = await createClient();
  await supabase.rpc("touch_seen");
}
