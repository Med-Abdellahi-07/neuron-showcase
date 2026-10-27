"use client";

import { ThemeProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { OfflineBanner } from "@/components/offline-banner";
import type { Locale } from "@/lib/i18n/dictionaries";

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  // يُسجَّل من أول تحميل لأي صفحة (حتى /login): أول زيارة تُثبّت قشرة التطبيق المحلية في الخلفية
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => {})) // كل فتح للتطبيق يفحص وجود نسخة جديدة
      .catch(() => {});
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider locale={locale}>{children}<OfflineBanner /></I18nProvider>
    </ThemeProvider>
  );
}
