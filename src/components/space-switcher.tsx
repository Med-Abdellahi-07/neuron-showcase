"use client";

import { useRef } from "react";
import { switchSpace } from "@/app/actions/spaces";
import { useT } from "@/lib/i18n/client";

export interface SpaceOption {
  id: string;
  label: string;
}

/** Quick switch for the super admin between spaces (only changes the space they "enter", nothing else). */
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
        className="h-[42px] max-w-[9rem] rounded-[14px] border-0 bg-deep-2 px-3 text-xs font-semibold text-white sm:max-w-none"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
    </form>
  );
}
