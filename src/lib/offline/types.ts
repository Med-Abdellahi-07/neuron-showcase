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
  pdfs: { name: string; url: string }[];
  questions: OfflineQuestion[];
  summaries: OfflineSummary[];
}
export interface OfflineScore {
  lessonId: string;
  at: number;
  correct: number;
  total: number;
}
