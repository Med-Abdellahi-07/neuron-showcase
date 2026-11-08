import { createAdminClient } from "@/lib/supabase/admin";
import { configuredProviders } from "./index";
import { dailyLimit, pressureFor } from "./pressure-model";

/**
 * "Pressure mode": when total daily usage nears the free providers' limits, point quotas are lowered for every student
 * (the factor lives in ai_settings.pressure, read by ai_spend), so students see "service busy" instead of an error.
 * The limits are approximate numbers, tunable through the Vercel variables AI_LIMIT_<PROVIDER>_DAILY (requests per day).
 */
let lastRun = 0;
export async function updatePressure(): Promise<void> {
  if (Date.now() - lastRun < 120_000) return;
  lastRun = Date.now();
  try {
    const admin = createAdminClient();
    const names = configuredProviders();
    if (!names.length) return;
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin.from("ai_provider_daily").select("provider, calls").eq("day", today).in("provider", names);
    const used = (data ?? []).reduce((a, r) => a + (r.calls as number), 0);
    const cap = names.reduce((a, n) => a + dailyLimit(n), 0);
    await admin.from("ai_settings").update({ pressure: pressureFor(cap ? used / cap : 0), updated_at: new Date().toISOString() }).eq("id", true);
  } catch {
    /* must not stop the work */
  }
}
