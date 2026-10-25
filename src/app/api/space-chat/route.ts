import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** قراءة رسائل غرفة الفضاء. الصلاحية والعزل في الدالة space_chat_list (my_cohort + ميزة chat). */
export async function GET(req: NextRequest) {
  const num = (k: string) => {
    const v = parseInt(req.nextUrl.searchParams.get(k) ?? "", 10);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("space_chat_list", { p_after: num("after"), p_before: num("before"), p_limit: num("limit") ?? 40 });
  if (error) {
    const m = error.message ?? "";
    const status = m.includes("not_authenticated") ? 401 : m.includes("feature_disabled") || m.includes("no_space") ? 403 : 500;
    if (status === 500) console.error("space_chat_list failed:", error.code, m);
    return NextResponse.json({ error: status === 500 ? "failed" : m.includes("not_authenticated") ? "auth" : "disabled" }, { status });
  }
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
