import type { GridSession } from "../schedule-grid.ts";

export interface OfflineQuestion {
  n: number;
  statement: string;
  options: string[];
  correct: number;
  explanation: string | null;
}
export interface OfflineSummary {
  id: string;
  title: string;
  kind: string;
  content: string;
  cards: { front: string; back: string; page: number | null }[] | null;
}
export interface OfflinePdf {
  name: string;
  blob: Blob;
}
/** حزمة حصة محفوظة على الجهاز */
export interface OfflinePack {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  /** رمز المادة (للتجميع في الصفحة المحلية)؛ قد يغيب في حزم قديمة */
  subjectCode?: string;
  savedAt: number;
  pdfs: OfflinePdf[];
  questions: OfflineQuestion[];
  summaries: OfflineSummary[];
}
/** ما يعيده الخادم قبل جلب ملفات PDF */
export interface PackManifest {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  subjectCode?: string;
  pdfs: { name: string; url: string; parts?: string[]; hashes?: string[] }[];
  questions: OfflineQuestion[];
  summaries: OfflineSummary[];
}
export interface OfflineScore {
  lessonId: string;
  at: number;
  correct: number;
  total: number;
}
/** نتيجة بانتظار الإرسال للخادم (تمرين فقط، لا ترتيب) */
export interface OutboxScore extends OfflineScore {
  clientId: string;
}

/**
 * نسخة الجدول المحفوظة عند كل فتح للتطبيق بنت. لا بريد ولا هاتف ولا رموز ولا محادثات:
 * الاسم المعروض واسم الفضاء والحصص والمواد فقط.
 */
export interface OfflineSnapshot {
  userId: string;
  name: string;
  space: string;
  locale: "ar" | "fr" | "en";
  /** المنطقة الزمنية للتطبيق (لحساب اليوم والساعة محليًا) */
  tz: string;
  savedAt: number;
  /** تاريخ بداية السداسي لترقيم الأسابيع */
  semesterStart: string | null;
  /** إثنين الأسبوع الافتراضي (الحالي، أو القادم يوم الأحد) */
  defaultMonday: string;
  /** حصص الأسبوع الحالي والقادم (مع شارة L1 للمواد المتبقية) */
  sessions: GridSession[];
  /** المواد المتبقية من L1 */
  remaining: { id: string; code: string; name: string }[];
  features: { ai: boolean; chat: boolean; ranking: boolean };
}
export interface RecentLesson {
  id: string;
  title: string;
  kind: string;
  number: number;
  subject: string;
  at: number;
}
