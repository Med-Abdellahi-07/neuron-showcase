import { createClient } from "@/lib/supabase/server";
import { SPACE_SELECT, toSpace } from "@/lib/spaces";

/** قائمة الفضاءات للتبديل السريع (للمشرف العام فقط) */
export async function getSpaceOptions(): Promise<{ id: string; label: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("cohorts").select(SPACE_SELECT).order("name");
  return (data ?? []).map((r) => {
    const sp = toSpace(r as never);
    return { id: sp.id, label: sp.name };
  });
}
