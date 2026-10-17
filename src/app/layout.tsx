import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
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
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0e16" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} suppressHydrationWarning>
      <body className="min-h-dvh antialiased">
        <Providers locale={locale}>{children}</Providers>
      </body>
    </html>
  );
}
