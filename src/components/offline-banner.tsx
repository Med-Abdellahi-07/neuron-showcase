"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { WifiOff } from "lucide-react";
import { useT } from "@/lib/i18n/client";

const subscribe = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

/** شريط يظهر عند انقطاع الاتصال ويقود إلى المحتوى المحفوظ */
export function OfflineBanner() {
  const { t } = useT();
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const path = usePathname();
  if (online || path.startsWith("/offline")) return null;
  return (
    <Link href="/offline" className="fixed inset-x-3 bottom-24 z-50 flex items-center gap-2 rounded-2xl bg-[var(--deep)] px-4 py-3 text-sm font-medium text-white shadow-lg" role="status">
      <WifiOff size={16} aria-hidden /> {t("off.banner")}
    </Link>
  );
}
