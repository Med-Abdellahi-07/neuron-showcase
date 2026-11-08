"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";

/** Updates "last seen" (the database function itself ignores repeats within 10 minutes). */
export async function touchSeen(): Promise<void> {
  if (!(await getUserId())) return;
  const supabase = await createClient();
  await supabase.rpc("touch_seen");
}
