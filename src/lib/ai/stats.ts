import type { SupabaseClient } from "@supabase/supabase-js";
import { drainFailures, drainUses } from "./index";
import { updatePressure } from "./pressure";

const LLM = ["gemini", "groq", "openrouter", "nvidia", "github"];

/**
 * Saves to the database what this server instance collected: the latest failure reason per provider and the daily usage counters.
 * Never throws. Called at the end of every path that uses AI.
 */
export async function flushAiStats(supabase: SupabaseClient): Promise<void> {
  try {
    const fails = drainFailures();
    const uses = drainUses();
    const failCount: Record<string, number> = {};
    for (const f of fails) {
      if (!LLM.includes(f.provider)) continue;
      failCount[f.provider] = (failCount[f.provider] ?? 0) + 1;
    }
    const lastBy = new Map<string, (typeof fails)[number]>();
    for (const f of fails) if (LLM.includes(f.provider)) lastBy.set(f.provider, f);
    const useCount: Record<string, number> = {};
    for (const u of uses) useCount[u] = (useCount[u] ?? 0) + 1;

    const jobs: PromiseLike<unknown>[] = [];
    for (const [provider, f] of lastBy)
      jobs.push(supabase.rpc("ai_note_error", { p_provider: provider, p_status: f.status, p_reason: f.reason ?? null, p_message: f.message }));
    for (const [provider, n] of Object.entries(failCount)) jobs.push(supabase.rpc("ai_note_use", { p_provider: provider, p_failed: true, p_n: n }));
    for (const [provider, n] of Object.entries(useCount)) jobs.push(supabase.rpc("ai_note_use", { p_provider: provider, p_failed: false, p_n: n }));
    await Promise.all(jobs);
    void updatePressure();
  } catch {
    /* Statistics must never stop the work. */
  }
}
