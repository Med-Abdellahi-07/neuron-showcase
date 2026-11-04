import { MULTI_SPACE } from "@/lib/flags";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubjectById } from "@/lib/data";
import { ENGLISH_CODE } from "@/lib/constants";
import type { Locale } from "@/lib/i18n/dictionaries";
import { sendPush, type PushMessage, type PushKind, type PushTarget } from "@/lib/push";

/** يرسل بعد انتهاء الاستجابة (لا يؤخر المدير) */
export function pushLater(target: PushTarget, kind: PushKind, msg: PushMessage) {
  after(async () => {
    await sendPush(target, kind, msg);
  });
}

const sub = async (id: string | null | undefined) => (id ? await getSubjectById(id) : null);

/** طلاب L2 الذين يتابعون هذه المادة كـ«مادة متبقية»: يصلهم ما يصل طلاب فضاء المادة. */
export async function followerIds(subjectId: string | null | undefined): Promise<string[]> {
  if (!MULTI_SPACE || !subjectId || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const { data, error } = await createAdminClient().from("remaining_subjects").select("student_id").eq("subject_id", subjectId);
  if (error) {
    console.error("followerIds failed:", error.code, error.message);
    return [];
  }
  return (data ?? []).map((r) => r.student_id as string);
}
export const KIND_LABEL: Record<Locale, Record<string, string>> = {
  ar: { cm: "محاضرة", td: "أعمال موجّهة", tp: "أعمال تطبيقية", resume: "ملخص" },
  fr: { cm: "Cours", td: "TD", tp: "TP", resume: "Résumé" },
  en: { cm: "Lecture", td: "TD", tp: "TP", resume: "Summary" },
};

export async function notifyNewLesson(l: { subject_id: string; kind: string; number: number; title: string; id: string }) {
  const s = await sub(l.subject_id);
  const name = s?.code ?? "";
  if (!s?.cohort_id) return;
  const followers = await followerIds(l.subject_id);
  pushLater({ cohortId: s.cohort_id, userIds: followers }, "new_content", {
    ar: { title: `درس جديد · ${name}`, body: `${KIND_LABEL.ar[l.kind] ?? l.kind} ${l.number}: ${l.title}` },
    fr: { title: `Nouveau cours · ${name}`, body: `${KIND_LABEL.fr[l.kind] ?? l.kind} ${l.number} : ${l.title}` },
    en: { title: `New session · ${name}`, body: `${KIND_LABEL.en[l.kind] ?? l.kind} ${l.number}: ${l.title}` },
    url: `/lessons/${l.id}`,
    tag: `lesson-${l.id}`,
  });
}

export async function notifyNewRecording(r: { cohort_id: string; subject_id: string; kind: string; title: string; lesson_id: string | null }) {
  const s = await sub(r.subject_id);
  const name = s?.code ?? "";
  pushLater({ cohortId: r.cohort_id }, "new_content", {
    ar: { title: `تسجيل جديد · ${name}`, body: r.title },
    fr: { title: `Nouvel enregistrement · ${name}`, body: r.title },
    en: { title: `New recording · ${name}`, body: r.title },
    url: r.lesson_id ? `/lessons/${r.lesson_id}` : s ? `/subjects/${s.code}` : "/subjects",
    tag: "recording",
  });
}

export async function notifyNewQuestions(subjectId: string, count: number) {
  const s = await sub(subjectId);
  const name = s?.code ?? "";
  if (!s?.cohort_id) return;
  const followers = await followerIds(subjectId);
  pushLater({ cohortId: s.cohort_id, userIds: followers }, "new_content", {
    ar: { title: `تمارين جديدة · ${name}`, body: `أُضيف ${count} سؤال للتدرّب` },
    fr: { title: `Nouveaux exercices · ${name}`, body: `${count} question(s) ajoutée(s)` },
    en: { title: `New exercises · ${name}`, body: `${count} question(s) added` },
    url: "/practice",
    tag: `questions-${subjectId}`,
  });
}

export function notifyAnnouncement(cohortId: string, title: string, body: string) {
  const short = body.replace(/\s+/g, " ").slice(0, 120);
  pushLater({ cohortId }, "announcement", {
    ar: { title: title, body: short },
    fr: { title: title, body: short },
    en: { title: title, body: short },
    url: "/",
    tag: "announcement",
  });
}

/** تغيير/إلغاء حصة. حصص الإنجليزية ذات المجموعة تصل لأصحاب المجموعة فقط. */
export async function notifyScheduleChange(s: {
  cohort_id: string;
  subject_id: string;
  kind: string;
  session_date: string;
  group_label: string | null;
  status: "cancelled" | "changed" | "scheduled";
  note: string | null;
}) {
  const subject = await sub(s.subject_id);
  let userIds: string[] | undefined;
  if (subject?.code === ENGLISH_CODE && s.group_label) {
    const admin = createAdminClient();
    const { data } = await admin.from("profiles").select("id, english_group").eq("cohort_id", s.cohort_id);
    const g = s.group_label.trim().toLowerCase();
    userIds = (data ?? []).filter((p) => !p.english_group || String(p.english_group).trim().toLowerCase() === g).map((p) => p.id as string);
    if (!userIds.length) return;
  }
  const name = subject?.code ?? "";
  const note = s.note ? ` — ${s.note}` : "";
  const cancelled = s.status === "cancelled";
  // طلاب L2 المتابعون للمادة يصلهم التغيير أيضاً (شارة L1 في جدولهم)
  const followers = await followerIds(s.subject_id);
  pushLater(userIds ? { userIds: [...userIds, ...followers] } : { cohortId: s.cohort_id, userIds: followers }, "schedule_change", {
    ar: { title: cancelled ? `أُلغيت حصة ${name}` : `تغيّرت حصة ${name}`, body: `${KIND_LABEL.ar[s.kind] ?? s.kind} · ${s.session_date}${note}` },
    fr: { title: cancelled ? `Séance annulée · ${name}` : `Séance modifiée · ${name}`, body: `${KIND_LABEL.fr[s.kind] ?? s.kind} · ${s.session_date}${note}` },
    en: { title: cancelled ? `Session cancelled · ${name}` : `Session changed · ${name}`, body: `${KIND_LABEL.en[s.kind] ?? s.kind} · ${s.session_date}${note}` },
    url: "/schedule",
    tag: `sched-${s.session_date}-${name}`,
  });
}
