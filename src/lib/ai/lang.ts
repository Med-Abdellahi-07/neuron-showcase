import { LOCALES, type Locale } from "@/lib/i18n/dictionaries";

/** Language of guided sessions and AI replies: the same as the UI languages, with French (the lessons' language) as the default. */
export type SessionLang = Locale;
export const SESSION_LANGS: SessionLang[] = ["fr", "ar", "en"];

export function asSessionLang(v: unknown): SessionLang {
  return LOCALES.includes(v as Locale) ? (v as Locale) : "fr";
}

/** Language name as written in the model instructions. */
export const LANG_NAME: Record<SessionLang, string> = {
  fr: "French",
  ar: "Arabic (keep technical terms in French as in the course)",
  en: "English (keep technical terms in French as in the course)",
};

/** "Out of syllabus" badge in the chosen language. */
export const OUT_OF_SYLLABUS: Record<SessionLang, string> = { fr: "Hors programme", ar: "خارج المنهج", en: "Out of syllabus" };
