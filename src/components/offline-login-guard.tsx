"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { getSnapshot } from "@/lib/offline/db";

/** Login page: offline with a saved copy on the device -> redirect to the local app; otherwise show a visible link to open it. */
export function OfflineLoginGuard() {
  const { t } = useT();
  const [has, setHas] = useState(false);
  useEffect(() => {
    let live = true;
    getSnapshot().then((s) => {
      if (!live || !s) return;
      if (!navigator.onLine) location.replace("/offline");
      else setHas(true);
    }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!has) return null;
  return (
    <a href="/offline" className="mx-auto mt-3 flex w-fit items-center gap-2 text-sm text-accent">
      <WifiOff size={14} aria-hidden /> {t("off.openOffline")}
    </a>
  );
}
