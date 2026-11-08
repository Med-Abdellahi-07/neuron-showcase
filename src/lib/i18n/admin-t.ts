import { DEFAULT_LOCALE, dictionaries, type DictKey, type Locale } from "./dictionaries";
import { getLocale } from "./server";

export type AdminT = (key: DictKey, params?: Record<string, string | number>) => string;

/** Translator with {name} placeholders for server code that builds admin-facing messages. */
export function makeT(locale: Locale): AdminT {
  const dict = dictionaries[locale];
  return (key, params) =>
    Object.entries(params ?? {}).reduce((text, [name, value]) => text.split(`{${name}}`).join(String(value)), dict[key] as string);
}

/** Translator for the current request's language (falls back to the default outside a request). */
export async function getAdminT(): Promise<AdminT> {
  let locale: Locale = DEFAULT_LOCALE;
  try {
    locale = await getLocale();
  } catch {
    /* outside a request scope */
  }
  return makeT(locale);
}
