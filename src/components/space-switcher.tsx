"use client";

import { useRef } from "react";
import { switchSpace } from "@/app/actions/spaces";
import { useT } from "@/lib/i18n/client";

export interface SpaceOption {
  id: string;
  label: string;
}

/** تبديل سريع للمشرف العام بين الفضاءات (يغيّر الفضاء الذي «يدخله» فقط، لا شيء آخر). */
export function SpaceSwitcher({ current, options }: { current: string; options: SpaceOption[] }) {
  const { t } = useT();
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={switchSpace} className="flex items-center">
      <label className="sr-only" htmlFor="space-switch">{t("space.switch")}</label>
      <select
        id="space-switch"
        name="cohort_id"
        defaultValue={current}
        onChange={() => form.current?.requestSubmit()}
        dir="ltr"
        className="h-10 max-w-[9rem] rounded-2xl border-0 bg-surface px-3 text-xs font-semibold text-accent shadow-[var(--shadow)] sm:max-w-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </form>
  );
}
