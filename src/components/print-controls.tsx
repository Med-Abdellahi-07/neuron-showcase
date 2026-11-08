"use client";

import { useEffect, useRef } from "react";
import { Printer, ArrowLeft } from "lucide-react";

/** Opens the print dialog automatically after fonts and formulas load, with a fallback button (some browsers block printing without a tap). */
export function PrintControls({
  title,
  printLabel,
  backLabel,
  howto,
  backHref,
}: {
  title: string;
  printLabel: string;
  backLabel: string;
  howto: string;
  backHref: string;
}) {
  const done = useRef(false);
  useEffect(() => {
    document.title = title;
    if (done.current) return;
    done.current = true;
    let cancelled = false;
    (async () => {
      try {
        await document.fonts?.ready;
      } catch {
        /* nothing to do */
      }
      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) {
        document.title = title; // Suggested file name for "Save as PDF".
        window.print();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [title]);

  return (
    <div className="print:hidden mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-800">
      <button type="button" onClick={() => {
          document.title = title;
          window.print();
        }} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-primary px-4 font-medium text-white">
        <Printer size={16} strokeWidth={1.9} aria-hidden /> {printLabel}
      </button>
      <a href={backHref} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-neutral-300 px-4">
        <ArrowLeft size={16} strokeWidth={1.9} className="rtl:rotate-180" aria-hidden /> {backLabel}
      </a>
      <p className="w-full text-xs text-neutral-600">{howto}</p>
    </div>
  );
}
