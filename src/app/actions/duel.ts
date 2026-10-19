"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth";
import { getAllSubjects } from "@/lib/data";
import { pushLater } from "@/lib/notify";
import { featureEnabled } from "@/lib/spaces";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KNOWN = ["duel_exists", "too_many", "not_enough_questions", "bad_opponent"];

/** إنشاء تحدٍّ: يُختار الخصم والمادة/الحصص، ثم ينتقل المتحدّي ليجيب أولاً. */
export async function createDuel(fd: FormData) {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  if (!(await featureEnabled("duel"))) redirect("/practice");
  const opponent = String(fd.get("opponent") ?? "");
  const subjectCode = String(fd.get("subject") ?? "");
  const lessons = fd.getAll("lessons").map(String).filter((x) => UUID_RE.test(x)).slice(0, 40);
  const count = Math.min(15, Math.max(5, parseInt(String(fd.get("count") ?? "8"), 10) || 8));
  const subject = (await getAllSubjects()).find((s) => s.code === subjectCode);
  if (!UUID_RE.test(opponent) || !subject) redirect("/practice/duel?err=generic");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_duel", { p_opponent: opponent, p_subject: subject.id, p_lessons: lessons, p_count: count });
  if (error || !data) {
    const code = KNOWN.find((k) => error?.message?.includes(k)) ?? "generic";
    if (code === "generic") console.error("create_duel failed:", error?.message);
    redirect(`/practice/duel?err=${code}`);
  }
  redirect(`/practice/duel/${data}`);
}

export interface DuelQuestion {
  id: string;
  statement: string;
  options: string[];
  difficulty: string;
  done: boolean;
}
export type DuelLoad = { ok: true; questions: DuelQuestion[] } | { ok: false; error: "unavailable" | "finished" | "expired" };

/** أول استدعاء يبدأ ساعة اللاعب. الأسئلة بلا إجابة صحيحة. */
export async function loadDuelQuestions(duelId: string): Promise<DuelLoad> {
  if (!UUID_RE.test(duelId) || !(await getUserId()) || !(await featureEnabled("duel"))) return { ok: false, error: "unavailable" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duel_questions", { p_duel: duelId });
  if (error || !data) {
    const m = error?.message ?? "";
    if (m.includes("already_finished")) return { ok: false, error: "finished" };
    if (m.includes("duel_expired") || m.includes("duel_not_playable")) return { ok: false, error: "expired" };
    return { ok: false, error: "unavailable" };
  }
  return { ok: true, questions: (data as { questions: DuelQuestion[] }).questions };
}

/** تسجيل إجابة. لا تُرجع صحتها. عند انتهاء اللاعب تُرسل الإشعارات المناسبة. */
export async function answerDuel(input: { duelId: string; questionId: string; selected: number }): Promise<{ ok: boolean; finished?: boolean }> {
  const userId = await getUserId();
  if (!userId || !(await featureEnabled("duel")) || !UUID_RE.test(input.duelId) || !UUID_RE.test(input.questionId) || !Number.isInteger(input.selected)) return { ok: false };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("duel_answer", { p_duel: input.duelId, p_question: input.questionId, p_selected: input.selected });
  if (error || !data) {
    console.error("duel_answer failed:", error?.message);
    return { ok: false };
  }
  const finished = !!(data as { finished?: boolean }).finished;
  if (finished) {
    try {
      const admin = createAdminClient();
      const { data: d } = await admin.from("duels").select("status, challenger_id, opponent_id").eq("id", input.duelId).maybeSingle();
      if (d) {
        const { data: me } = await admin.from("profiles").select("full_name").eq("id", userId).maybeSingle();
        const name = (me?.full_name as string | undefined)?.split(" ")[0] ?? "";
        if (d.status === "open" && d.challenger_id === userId) {
          pushLater({ userIds: [d.opponent_id as string] }, "duel", {
            ar: { title: "تحدٍّ جديد", body: `${name} يتحداك! لديك 48 ساعة للإجابة.` },
            fr: { title: "Nouveau duel", body: `${name} te défie ! Tu as 48 h pour répondre.` },
            en: { title: "New duel", body: `${name} challenges you! You have 48 h to answer.` },
            url: `/practice/duel/${input.duelId}`,
            tag: `duel-${input.duelId}`,
          });
        } else if (d.status === "completed" && d.opponent_id === userId) {
          pushLater({ userIds: [d.challenger_id as string] }, "duel", {
            ar: { title: "انتهى التحدي", body: `${name} أنهى تحديك. اطّلع على النتيجة.` },
            fr: { title: "Duel terminé", body: `${name} a terminé ton duel. Vois le résultat.` },
            en: { title: "Duel finished", body: `${name} finished your duel. See the result.` },
            url: `/practice/duel/${input.duelId}`,
            tag: `duel-${input.duelId}`,
          });
        }
      }
    } catch (e) {
      console.error("duel notify failed:", (e as Error).message);
    }
  }
  return { ok: true, finished };
}
