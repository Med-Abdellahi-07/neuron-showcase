"use client";

import { useEffect } from "react";
import { flushOutbox, syncSnapshot } from "@/lib/offline/sync";

/** يُركَّب داخل التطبيق المسجَّل: عند كل فتح (وعند عودة الاتصال) يحفظ لقطة الجدول ويرسل النتائج المعلّقة. */
export function OfflineSync() {
  useEffect(() => {
    if (!("indexedDB" in window)) return;
    const run = () => {
      if (!navigator.onLine) return;
      syncSnapshot().catch(() => {});
      flushOutbox().catch(() => {});
    };
    run();
    window.addEventListener("online", run);
    return () => window.removeEventListener("online", run);
  }, []);
  return null;
}
