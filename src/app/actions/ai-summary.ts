"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { generateJson, generateText } from "@/lib/ai";
import { flushAiStats } from "@/lib/ai/stats";
import { asSessionLang, LANG_NAME, type SessionLang } from "@/lib/ai/lang";
import { loadMaterial } from "@/lib/ai/material";
import { refundPoints, spendErrorCode, spendPoints } from "@/lib/ai/points";
import type { FormState } from "@/app/actions/auth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUMMARY_KINDS = ["short", "detailed", "sheet", "flashcards"] as const;
type Kind = (typeof SUMMARY_KINDS)[number];
const MAX_LESSONS = 6;

const KIND_RULES: Record<Kind, string> = {
  short: "Write a SHORT summary: 8-12 concise bullet points (max ~200 words) with the essential ideas only.",
  detailed:
    "Write a DETAILED structured summary with Markdown headings per lesson/section, precise definitions, formulas (LaTeX: $...$) and one short example when the course gives one.",
  sheet:
    "Write a one-page REVISION SHEET for the night before the exam: key definitions, must-know formulas, common pitfalls/confusions, and a final self-check list (5 items). Dense and scannable.",
  flashcards:
    'Return ONLY JSON: {"cards":[{"front":"question or term","back":"short precise answer","page":3}]} with 12 to 20 memorisation cards covering the most examinable points. "page" is the course page number or null.',
};

/**
 * Personal summary: built only from indexed lesson text with page references, and stored for that student only.
 * Reopening a summary is free; generating (and regenerating) costs 5 points, refunded if every provider fails.
 */
export async function generateSummary(_prev: FormState, fd: FormData): Promise<FormState> {
  const { t } = await getT();
  const userId = await getUserId();
  if (!userId) return { error: t("common.error") };
  const lessonIds = [...new Set(fd.getAll("lesson").map(String).filter((x) => UUID_RE.test(x)))];
  const kind = String(fd.get("kind") ?? "");
  const lang: SessionLang = asSessionLang(fd.get("lang"));
  const replaceId = String(fd.get("replace") ?? "");
  if (!lessonIds.length || lessonIds.length > MAX_LESSONS || !(SUMMARY_KINDS as readonly string[]).includes(kind))
    return { error: lessonIds.length > MAX_LESSONS ? t("sum.tooMany").replace("{max}", String(MAX_LESSONS)) : t("sum.pickLessons") };

  const supabase = await createClient();
  const spent = await spendPoints(supabase, "summary");
  if (!spent.ok) return { error: t(`ai.err.${spendErrorCode(spent)}`) };

  let newId: string | null = null;
  try {
    const mat = await loadMaterial(supabase, lessonIds, 26_000);
    if (!mat) { await refundPoints(spent.ledgerId); return { error: t("common.error") }; }
    if (!mat.text) { await refundPoints(spent.ledgerId); return { error: t("ai.err.noMaterial") }; }

    // Prior weak points in these lessons: only the wording of questions answered wrongly (no identifying information).
    const { data: qs } = await supabase.from("questions").select("id").in("lesson_id", lessonIds).eq("type", "mcq").limit(400);
    let weak: string[] = [];
    const qIds = (qs ?? []).map((q) => q.id as string);
    if (qIds.length) {
      const { data: wrong } = await supabase
        .from("attempt_answers").select("question_id").eq("user_id", userId).eq("is_correct", false).in("question_id", qIds)
        .order("answered_at", { ascending: false }).limit(40);
      const ids = [...new Set((wrong ?? []).map((w) => w.question_id as string))].slice(0, 8);
      if (ids.length) {
        const { data: st } = await supabase.from("questions").select("statement").in("id", ids);
        weak = (st ?? []).map((x) => String(x.statement).slice(0, 200));
      }
    }

    const system = [
      "You are Neuron, a study assistant. Build the requested study material ONLY from the COURSE EXTRACTS below; do not invent facts that are not in them.",
      `LANGUAGE: write in ${LANG_NAME[lang]}. Keep technical terms in French as in the course. Math in LaTeX.`,
      "CITATIONS: cite the source page after each key point like (p. 4) using the page tags [L1 p.4] of the extracts. Never invent a page.",
      KIND_RULES[kind as Kind],
      weak.length
        ? `The learner previously answered these course questions wrongly, so give extra clarity to the related points (do not mention the learner or these questions):\n${weak.map((w) => `- ${w}`).join("\n")}`
        : "",
      "COURSE EXTRACTS:\n" + mat.text,
    ].filter(Boolean).join("\n\n");

    let content = "";
    let cards: { front: string; back: string; page: number | null }[] | null = null;
    if (kind === "flashcards") {
      const { data } = await generateJson<{ cards?: { front?: string; back?: string; page?: number | null }[] }>({
        system, messages: [{ role: "user", text: "Generate the cards." }], maxTokens: 3500, temperature: 0.3,
      });
      cards = (data.cards ?? [])
        .filter((c) => c.front && c.back)
        .slice(0, 30)
        .map((c) => ({ front: String(c.front).slice(0, 300), back: String(c.back).slice(0, 600), page: Number.isInteger(c.page) ? (c.page as number) : null }));
      if (cards.length < 4) throw new Error("too_few_cards");
      content = cards.map((c, i) => `${i + 1}. ${c.front} → ${c.back}`).join("\n");
    } else {
      const r = await generateText({ system, messages: [{ role: "user", text: "Write it now." }], maxTokens: kind === "detailed" ? 3500 : 2000, temperature: 0.3 });
      content = r.text.trim();
    }

    const first = mat.lessons[0];
    const { data: subj } = await supabase.from("lessons").select("subject_id").eq("id", first.id).maybeSingle();
    const title = mat.lessons.length === 1 ? `${first.kind.toUpperCase()} ${first.number} — ${first.title}` : mat.lessons.map((l) => `${l.kind.toUpperCase()} ${l.number}`).join(", ");
    const { data: coh } = await supabase.from("profiles").select("cohort_id").eq("id", userId).maybeSingle();
    const { data: row, error } = await supabase
      .from("ai_summaries")
      .insert({ user_id: userId, cohort_id: coh?.cohort_id, subject_id: (subj?.subject_id as string) ?? null, lesson_ids: lessonIds, kind, lang, title, content, cards })
      .select("id").single();
    if (error || !row) throw new Error(error?.message ?? "insert_failed");
    newId = row.id as string;
    if (UUID_RE.test(replaceId)) await supabase.from("ai_summaries").delete().eq("id", replaceId).eq("user_id", userId);
  } catch (e) {
    console.error("generateSummary failed:", e instanceof Error ? e.message : e);
    await refundPoints(spent.ledgerId);
    await flushAiStats(supabase);
    return { error: t("ai.err.unavailable") };
  }
  await flushAiStats(supabase);
  revalidatePath("/assistant/summaries");
  redirect(`/assistant/summaries/${newId}`);
}

export async function deleteSummary(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  if (!UUID_RE.test(id) || !(await getUserId())) return;
  const supabase = await createClient();
  await supabase.from("ai_summaries").delete().eq("id", id);
  revalidatePath("/assistant/summaries");
}
