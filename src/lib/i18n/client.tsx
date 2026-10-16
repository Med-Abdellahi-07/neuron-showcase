"use client";

import { createContext, useContext, type ReactNode } from "react";
import { dictionaries, type DictKey, type Locale } from "./dictionaries";

const Ctx = createContext<Locale>("ar");

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useT() {
  const locale = useContext(Ctx);
  const dict = dictionaries[locale];
  return { locale, t: (key: DictKey) => dict[key] };
}
