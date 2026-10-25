import type { Metadata, Viewport } from "next";
import "./globals.css";
import { fontClasses } from "./fonts";
import { Providers } from "@/components/providers";
import { Splash } from "@/components/splash";
import { getLocale } from "@/lib/i18n/server";
import { isRtl } from "@/lib/i18n/dictionaries";

export const metadata: Metadata = {
  title: { default: "Neuron", template: "%s · Neuron" },
  description: "Neuron — AI study platform for university students",
  applicationName: "Neuron",
  appleWebApp: { capable: true, title: "Neuron", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F2FB" },
    { media: "(prefers-color-scheme: dark)", color: "#120A2E" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className={fontClasses} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers locale={locale}>
          {children}
          <Splash />
        </Providers>
      </body>
    </html>
  );
}
