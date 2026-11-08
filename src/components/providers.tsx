"use client";

import { ThemeProvider } from "next-themes";
import { useEffect, type ReactNode } from "react";
import { I18nProvider } from "@/lib/i18n/client";
import { OfflineBanner } from "@/components/offline-banner";
import type { Locale } from "@/lib/i18n/dictionaries";

export function Providers({ locale, children }: { locale: Locale; children: ReactNode }) {
  // Registered on the first load of any page (even /login): the first visit installs the local app shell in the background.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => {})) // Every app open checks for a new version.
      .catch(() => {});
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <I18nProvider locale={locale}>{children}<OfflineBanner /></I18nProvider>
    </ThemeProvider>
  );
}
