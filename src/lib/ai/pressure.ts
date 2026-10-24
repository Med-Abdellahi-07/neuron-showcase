import { createAdminClient } from "@/lib/supabase/admin";
import { configuredProviders } from "./index";
import { dailyLimit, pressureFor } from "./pressure-model";

/**
 * «وضع الضغط»: إذا اقترب الاستهلاك الكلي اليومي من حدود المزوّدين المجانيين تُخفَّض حصص النقاط لكل الطلاب
 * (المعامل في ai_settings.pressure، تقرؤه ai_spend)، فيرى الطالب «الخدمة مزدحمة» بدل خطأ.
 * الحدود أرقام تقريبية قابلة للضبط بمتغيرات Vercel AI_LIMIT_<PROVIDER>_DAILY (عدد الطلبات يومياً).
 */
let lastRun = 0;
export async function updatePressure(): Promise<void> {
  if (Date.now() - lastRun < 120_000) return;
  lastRun = Date.now();
  try {
    const admin = createAdminClient();
    const names = configuredProviders().filter((n) => n !== "mistral");
    if (!names.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin.from("ai_provider_daily").select("provider, calls").eq("day", today).in("provider", names);
    const used = (data ?? []).reduce((a, r) => a + (r.calls as number), 0);
    const cap = names.reduce((a, n) => a + dailyLimit(n), 0);
    await admin.from("ai_settings").update({ pressure: pressureFor(cap ? used / cap : 0), updated_at: new Date().toISOString() }).eq("id", true);
  } catch {
    /* لا يوقف العمل */
  }
}
