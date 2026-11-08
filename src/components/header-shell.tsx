"use client";

import { usePathname } from "next/navigation";

/** Pages that render their own header (Home, Timetable, Assistant, Progress), so the global header is hidden above them. */
const OWN_HEADER = new Set(["/", "/schedule", "/assistant", "/progress"]);

export function HeaderShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (OWN_HEADER.has(path)) return null;
  return (
    <header className="relative z-10 mb-1 flex h-[76px] items-center justify-between rounded-b-[var(--r-head)] bg-deep px-5 text-white md:px-8">
      {children}
    </header>
  );
}
