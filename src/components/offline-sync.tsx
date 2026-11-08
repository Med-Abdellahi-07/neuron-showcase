"use client";

import { useEffect } from "react";
import { flushOutbox, syncSnapshot } from "@/lib/offline/sync";

/** Mounted inside the signed-in app: on every open (and when the connection returns) it saves the timetable snapshot and sends pending results. */
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
