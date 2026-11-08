import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, dictionaries, type DictKey, type Locale } from "./dictionaries";

export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value as Locale | undefined;
  return value && LOCALES.includes(value) ? value : DEFAULT_LOCALE;
}

/** Translator for server components. */
export async function getT() {
  const locale = await getLocale();
  const dict = dictionaries[locale];
  return { locale, t: (key: DictKey) => dict[key] };
}
