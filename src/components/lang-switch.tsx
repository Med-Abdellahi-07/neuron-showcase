"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/dictionaries";

const LABELS: Record<Locale, string> = { ar: "العربية", fr: "Français" };

export function LangSwitch() {
  const { locale } = useT();
  const [pending, start] = useTransition();
  return (
    <div className="inline-flex rounded-[var(--radius)] border border-border p-0.5" role="group" aria-label="Language">
      {(Object.keys(LABELS) as Locale[]).map((l) => (
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
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
