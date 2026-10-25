"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";
import { getAllSubjects } from "@/lib/data";
import { featureEnabled } from "@/lib/spaces";
import { flushAiStats } from "@/lib/ai/stats";
import { asSessionLang } from "@/lib/ai/lang";
import { loadMaterial } from "@/lib/ai/material";
import { refundPoints, spendErrorCode, spendPoints } from "@/lib/ai/points";
import { DIFFS, generateQuestions, parseCount, recentStatements, type Difficulty } from "@/lib/ai/qcm-gen";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = ["duel_exists", "too_many", "not_enough_questions", "bad_opponent", "bad_subject"];
const MAX_LESSONS = 10;

/**
 * Duel بأسئلة يولّدها الذكاء الاصطناعي من نص الدروس (المتحدّي يختار الزميل والمادة والحصص والعدد 5..15).
 * الأسئلة تُخزَّن بحالة private عبر create_ai_duel (service_role فقط) فلا تظهر في أي تمرين ولا للطاقم.
 * الطلب يُحسب ضمن السقف الخفي ويُلغى عند أي فشل قبل إنشاء التحدي.
 */
export async function createAiDuel(fd: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  if (!(await featureEnabled("duel"))) redirect("/practice");
  const opponent = String(fd.get("opponent") ?? "");
  const subjectCode = String(fd.get("subject") ?? "");
  let lessonIds = [...new Set(fd.getAll("lessons").map(String).filter((x) => UUID_RE.test(x)))].slice(0, MAX_LESSONS);
  const count = parseCount(fd.get("count"), 5, 15) ?? 8;
  const difficulty = (DIFFS as readonly string[]).includes(String(fd.get("difficulty"))) ? (String(fd.get("difficulty")) as Difficulty) : "medium";
  const lang = asSessionLang(fd.get("lang"));
  const subject = (await getAllSubjects()).find((s) => s.code === subjectCode);
  if (!UUID_RE.test(opponent) || !subject) redirect("/practice/duel?err=generic");

  const supabase = await createClient();
  // بلا حصص محددة: نأخذ حصص المادة المنشورة (حتى 10، موزّعة)
  if (!lessonIds.length) {
    const { data } = await supabase.from("lessons").select("id").eq("subject_id", subject.id).eq("status", "published").order("number").limit(60);
    const all = (data ?? []).map((l) => l.id as string);
    const step = Math.max(1, Math.ceil(all.length / MAX_LESSONS));
    lessonIds = all.filter((_, i) => i % step === 0).slice(0, MAX_LESSONS);
  } else {
    const { data } = await supabase.from("lessons").select("id, subject_id").in("id", lessonIds);
    if ((data ?? []).length !== lessonIds.length || (data ?? []).some((l) => l.subject_id !== subject.id)) redirect("/practice/duel?err=generic");
  }
  if (!lessonIds.length) redirect("/practice/duel?err=ai_noMaterial");

  const spent = await spendPoints(supabase, "duel");
  if (!spent.ok) redirect(`/practice/duel?err=ai_${spendErrorCode(spent)}`);

  let duelId: string | null = null;
  let code = "ai_unavailable";
  try {
    const mat = await loadMaterial(supabase, lessonIds, 24_000);
    if (!mat?.text) { code = "ai_noMaterial"; throw new Error("no_material"); }
    const good = await generateQuestions({ mat, count, difficulty, lang, avoid: await recentStatements(supabase, subject.id) });
    if (good.length < 5) throw new Error("too_few_valid");
    const payload = good.slice(0, count).map((g) => ({
      statement: g.statement, options: g.options, correct_index: g.correctIndex, explanation: g.explanation, lesson: g.lessonId,
    }));
    const { data, error } = await createAdminClient().rpc("create_ai_duel", {
      p_uid: userId, p_opponent: opponent, p_subject: subject.id, p_lessons: lessonIds, p_questions: payload,
    });
    if (error || !data) {
      const k = KNOWN.find((x) => error?.message?.includes(x));
      if (k) code = k;
      throw new Error(error?.message ?? "create_failed");
    }
    duelId = data as string;
  } catch (e) {
    console.error("createAiDuel failed:", e instanceof Error ? e.message : e);
    await refundPoints(spent.ledgerId);
  }
  await flushAiStats(supabase);
  redirect(duelId ? `/practice/duel/${duelId}` : `/practice/duel?err=${code}`);
}
