"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/client";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n/dictionaries";

export function LangSwitch() {
  const { locale } = useT();
  const [pending, start] = useTransition();
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-border p-0.5" role="group" aria-label="Language">
      {LOCALES.map((l: Locale) => (
        <button
          key={l}
          type="button"
          disabled={pending}
          onClick={() => start(() => setLocale(l))}
          className={`min-h-8 rounded-[calc(var(--radius)-2px)] px-3 text-xs font-medium transition-colors ${
            l === locale ? "bg-accent text-accent-fg" : "text-muted hover:text-fg"
          }`}
          aria-pressed={l === locale}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
