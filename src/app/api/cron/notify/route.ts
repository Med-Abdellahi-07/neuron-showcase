import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCatalog } from "@/lib/catalog";
import { addDays, todayISO } from "@/lib/dates";
import { SLOTS } from "@/lib/constants";
import { visibleForGroup } from "@/lib/data";
import { pushConfigured, sendPush } from "@/lib/push";
import { KIND_LABEL } from "@/lib/notify";
import type { Locale } from "@/lib/i18n/dictionaries";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}


/**
 * المهمة اليومية (Vercel Cron على خطة Hobby: مرة يومياً؛ أو GitHub Actions احتياطاً).
 * آمنة للتكرار: notification_log يمنع إرسال الإشعار نفسه مرتين.
 */
export async function GET(req: Request) {
  if (!authorized(req)) return new Response("unauthorized", { status: 401 });
  if (!pushConfigured()) return Response.json({ ok: false, error: "push_not_configured" }, { status: 200 });

  const admin = createAdminClient();
  const out = { lessonTomorrow: 0, review: 0, duelRemind: 0, duelExpired: 0 };
  const today = todayISO();
  const tomorrow = addDays(today, 1);

  /** يعيد true إن لم يكن قد أُرسل من قبل، ويسجّله (فشل التسجيل = لا إرسال، لتفادي التكرار) */
  async function once(userId: string, kind: string, ref: string): Promise<boolean> {
    const { error } = await admin.from("notification_log").insert({ user_id: userId, kind, ref });
    return !error;
  }

  // 1) مباريات انتهت مهلتها
  await admin.rpc("duel_sweep");

  // 2) حصة غداً
  try {
    const { subjects } = await getCatalog();
    const code = new Map(subjects.map((s) => [s.id, s.code]));
    const name = new Map(subjects.map((s) => [s.id, s.name]));
    const { data: sessions } = await admin
      .from("schedule_sessions")
      .select("cohort_id, slot, subject_id, kind, room, group_label, status")
      .eq("session_date", tomorrow)
      .neq("status", "cancelled");
    if (sessions?.length) {
      const cohorts = [...new Set(sessions.map((s) => s.cohort_id as string))];
      const { data: people } = await admin.from("profiles").select("id, cohort_id, english_group").in("cohort_id", cohorts);
      for (const p of people ?? []) {
        const mine = sessions
          .filter((s) => s.cohort_id === p.cohort_id && visibleForGroup({ group_label: s.group_label as string | null }, code.get(s.subject_id as string), { english_group: p.english_group as string | null }))
          .sort((a, b) => (a.slot as number) - (b.slot as number));
        if (!mine.length) continue;
        if (!(await once(p.id as string, "lesson_tomorrow", tomorrow))) continue;
        const first = SLOTS.find((x) => x.n === mine[0].slot);
        const list = (lang: Locale) =>
          mine.map((s) => `${SLOTS.find((x) => x.n === s.slot)?.start ?? ""} ${KIND_LABEL[lang][s.kind as string] ?? s.kind} ${code.get(s.subject_id as string) ?? ""}`).join(" · ");
        const r = await sendPush({ userIds: [p.id as string] }, "lesson_tomorrow", {
          ar: { title: `غداً ${mine.length} حصص — تبدأ ${first?.start ?? ""}`, body: list("ar") },
          fr: { title: `Demain : ${mine.length} séance(s) — dès ${first?.start ?? ""}`, body: list("fr") },
          en: { title: `Tomorrow: ${mine.length} session(s) — from ${first?.start ?? ""}`, body: list("en") },
          url: "/schedule",
          tag: `tomorrow-${tomorrow}`,
        });
        if (r.sent > 0) out.lessonTomorrow += 1;
        void name;
      }
    }
  } catch (e) {
    console.error("cron lesson_tomorrow failed:", (e as Error).message);
  }

  // 3) تذكير المراجعة الذكية (مرة يومياً لمن لديه مستحقات)
  try {
    const { data: due } = await admin.rpc("review_reminder_targets");
    for (const d of (due ?? []) as { user_id: string; due: number }[]) {
      if (!(await once(d.user_id, "review", today))) continue;
      const r = await sendPush({ userIds: [d.user_id] }, "review", {
        ar: { title: "وقت المراجعة", body: `لديك ${d.due} سؤال مستحق للمراجعة اليوم.` },
        fr: { title: "Révision du jour", body: `${d.due} question(s) à réviser aujourd'hui.` },
        en: { title: "Time to review", body: `${d.due} question(s) due for review today.` },
        url: "/practice",
        tag: "review",
      });
      if (r.sent > 0) out.review += 1;
    }
  } catch (e) {
    console.error("cron review failed:", (e as Error).message);
  }

  // 4) Duel: تذكير الخصم قبل انتهاء المهلة بـ 12 ساعة، وإعلام الطرفين بالنتيجة عند انتهاء المهلة
  try {
    const soon = new Date(Date.now() + 12 * 3600_000).toISOString();
    const { data: ending } = await admin.from("duels").select("id, opponent_id").eq("status", "open").lte("expires_at", soon);
    for (const d of ending ?? []) {
      if (!(await once(d.opponent_id as string, "duel_remind", d.id as string))) continue;
      const r = await sendPush({ userIds: [d.opponent_id as string] }, "duel", {
        ar: { title: "⏳ تحدٍّ ينتهي قريباً", body: "أقل من 12 ساعة للإجابة وإلا يفوز خصمك." },
        fr: { title: "⏳ Duel bientôt expiré", body: "Moins de 12 h pour répondre, sinon ton adversaire gagne." },
        en: { title: "⏳ Duel about to expire", body: "Less than 12 h left to answer, otherwise your opponent wins." },
        url: `/practice/duel/${d.id}`,
        tag: `duel-${d.id}`,
      });
      if (r.sent > 0) out.duelRemind += 1;
    }
    const since = new Date(Date.now() - 2 * 86400_000).toISOString();
    const { data: expired } = await admin.from("duels").select("id, challenger_id, opponent_id").eq("status", "expired").gte("completed_at", since);
    for (const d of expired ?? []) {
      for (const uid of [d.challenger_id as string, d.opponent_id as string]) {
        if (!(await once(uid, "duel_expired", d.id as string))) continue;
        const won = uid === d.challenger_id;
        const r = await sendPush({ userIds: [uid] }, "duel", {
          ar: { title: "انتهت مهلة التحدي", body: won ? "لم يُجب خصمك في الوقت: فزت!" : "انتهت المهلة قبل أن تجيب: فاز المتحدّي." },
          fr: { title: "Duel expiré", body: won ? "Ton adversaire n'a pas répondu à temps : victoire !" : "Délai dépassé : le challenger gagne." },
          en: { title: "Duel expired", body: won ? "Your opponent didn't answer in time: you win!" : "Time ran out before you answered: the challenger wins." },
          url: `/practice/duel/${d.id}`,
          tag: `duel-${d.id}`,
        });
        if (r.sent > 0) out.duelExpired += 1;
      }
    }
  } catch (e) {
    console.error("cron duel failed:", (e as Error).message);
  }

  return Response.json({ ok: true, date: today, ...out });
}
