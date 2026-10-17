import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";

/** لغة الجلسة الموجّهة وردود الذكاء الاصطناعي: نفس لغات الواجهة، والفرنسية (لغة الدروس) هي الافتراضية */
export type SessionLang = Locale;
export const SESSION_LANGS: SessionLang[] = ["fr", "ar", "en"];

export function asSessionLang(v: unknown): SessionLang {
  return LOCALES.includes(v as Locale) ? (v as Locale) : "fr";
}

/** اسم اللغة كما يُكتب في تعليمات النموذج */
export const LANG_NAME: Record<SessionLang, string> = {
  fr: "French",
  ar: "Arabic (keep technical terms in French as in the course)",
  en: "English (keep technical terms in French as in the course)",
};

/** شارة «خارج المنهج» باللغة المختارة */
export const OUT_OF_SYLLABUS: Record<SessionLang, string> = { fr: "Hors programme", ar: "خارج المنهج", en: "Out of syllabus" };
