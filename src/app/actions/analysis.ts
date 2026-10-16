"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getLocale } from "@/lib/i18n/server";
import { generateText } from "@/lib/ai";

/** تحليل أداء الطالب: تُرسل للنموذج إحصاءات مجمّعة فقط، بلا اسم ولا بريد ولا هاتف. */
export async function refreshAnalysis(): Promise<{ ok: boolean; error?: "busy" | "unavailable" | "empty" }> {
  const userId = await getUserId();
  if (!userId) return { ok: false, error: "unavailable" };
  const supabase = await createClient();

  const { data: allowed } = await supabase.rpc("ai_take", {
    p_kind: "analysis",
    p_window_limit: 2,
    p_window_seconds: 3600,
    p_day_limit: 5,
  });
  if (allowed !== true) return { ok: false, error: "busy" };

  const { data: stats, error } = await supabase.rpc("my_stats", { p_user: userId });
  if (error || !stats) return { ok: false, error: "unavailable" };
  if (!(stats as { answered: number }).answered) return { ok: false, error: "empty" };

  const locale = await getLocale();
  try {
    const { text } = await generateText({
      system: [
        "You are a study coach for a university student in an AI program. You receive aggregated practice statistics (JSON) with no personal data.",
        `Write in ${locale === "ar" ? "Arabic (keep technical terms in French)" : "French"}. Markdown, max 220 words, with these short sections: strengths, weak spots (name subjects/topics from the data), and a concrete 3-step study plan for the next week.`,
        "Only use facts present in the JSON. If the sample is small, say that the conclusions are provisional. Be encouraging, never harsh.",
      ].join("\n"),
      messages: [{ role: "user", text: JSON.stringify(stats) }],
      maxTokens: 700,
      temperature: 0.4,
    });
    const { error: upErr } = await supabase
      .from("student_analysis")
      .upsert({ user_id: userId, content: text.trim(), locale, generated_at: new Date().toISOString() });
    if (upErr) {
      console.error("analysis upsert failed:", upErr.message);
      return { ok: false, error: "unavailable" };
    }
  } catch (e) {
    console.error("analysis failed:", (e as Error).message);
    return { ok: false, error: "unavailable" };
  }
  revalidatePath("/assistant/analysis");
  return { ok: true };
}
