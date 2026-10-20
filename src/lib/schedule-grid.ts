import { SLOTS } from "@/lib/constants";
import type { ScheduleSession, Subject } from "@/lib/types";

/** الحصة كما تصل إلى شبكة الجدول (بيانات بسيطة قابلة للتمرير إلى مكوّن عميل) */
export interface GridSession {
  id: string;
  date: string;
  slot: number;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  kind: "cm" | "td" | "tp";
  room: string | null;
  teacher: string | null;
  sharedWith: string | null;
  groupLabel: string | null;
  status: "scheduled" | "cancelled" | "changed";
  note: string | null;
  /** رقم لون المادة (ثابت لكل مادة) */
  color: number;
  /** حصة مادة متبقية من L1 (من فضاء آخر) ← شارة «L1» */
  l1: boolean;
}

/** درجات اللون (HSL hue): الأزرق أولاً ثم ألوان متناسقة معه. تُخلط مع لون السطح فتبقى خفيفة في الوضعين. */
export const SUBJECT_HUES = [214, 258, 172, 38, 196, 146, 82, 234, 52, 282] as const;
export const hueOf = (color: number) => SUBJECT_HUES[((color % SUBJECT_HUES.length) + SUBJECT_HUES.length) % SUBJECT_HUES.length];

const hash = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/**
 * لون كل مادة: ترتيبها في مواد السداسي الحالي (فلا يتكرر لونان داخل السداسي)،
 * وأي مادة خارجه تأخذ لوناً ثابتاً من رمزها.
 */
export function colorMap(current: Pick<Subject, "id" | "code">[], extra: Pick<Subject, "id" | "code">[] = []): Map<string, number> {
  const m = new Map<string, number>();
  current.forEach((s, i) => m.set(s.id, i));
  for (const s of extra) if (!m.has(s.id)) m.set(s.id, hash(s.code));
  return m;
}

export function toGridSession(s: ScheduleSession, subject: Pick<Subject, "code" | "name"> | undefined, color: number, l1 = false): GridSession {
  return {
    id: s.id,
    date: s.session_date,
    slot: s.slot,
    subjectId: s.subject_id,
    subjectCode: subject?.code ?? "",
    subjectName: subject?.name ?? "—",
    kind: s.kind,
    room: s.room,
    teacher: s.teacher,
    sharedWith: s.shared_with,
    groupLabel: s.group_label,
    status: s.status,
    note: s.note,
    color,
    l1,
  };
}

/** رقم الفترة الجارية الآن (HH:MM)؛ لا شيء بين الفترات (مثل 11:00–11:10) */
export function slotAt(hm: string): number | null {
  return SLOTS.find((s) => s.start <= hm && hm < s.end)?.n ?? null;
}

export const VIEW_COOKIE = "neuron-sched-view";

/** يحفظ اختيار الطالب (شبكة/يوم) في كوكي يقرؤها الخادم عند أول رسم، فلا يومض العرض */
export function saveView(v: ScheduleView) {
  try {
    document.cookie = `${VIEW_COOKIE}=${v}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* الكوكيز غير متاحة: الاختيار يبقى لهذه الزيارة فقط */
  }
}
export type ScheduleView = "grid" | "day";
