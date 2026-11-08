"use client";

import { useRouter } from "next/navigation";

/** Month button in "Progress": a native select styled as a button (excellent accessibility without a custom popup). */
export function MonthSelect({ value, options, label }: { value: string; options: { ym: string; label: string }[]; label: string }) {
  const router = useRouter();
  const current = options.find((o) => o.ym === value)?.label ?? value;
  return (
    <span className="relative inline-flex h-9 items-center rounded-xl border border-[var(--border-input)] bg-surface px-3 text-xs">
      <span aria-hidden="true">{current} ▾</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => router.push(`/progress?m=${e.target.value}`)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        {options.map((o) => (
          <option key={o.ym} value={o.ym}>{o.label}</option>
        ))}
      </select>
    </span>
  );
}
