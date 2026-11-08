"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";

export interface AiTab {
  href: string;
  key: "ai.tab.chat" | "ai.tab.summaries" | "ai.tab.qcm";
}

/** AI sections bar + daily points counter ("X left today"). */
export function AiTabs({ tabs, pressured }: { tabs: AiTab[]; pressured: boolean }) {
  const { t } = useT();
  const path = usePathname();
  // The assistant home and chat pages have their own UI (section cards in the header).
  if (path === "/assistant" || /^\/assistant\/(?!summaries|qcm|analysis)/.test(path)) return null;
  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("nav.assistant")} className="flex flex-wrap gap-1.5">
          {tabs.map((x) => {
            const active = x.href === "/assistant" ? path === "/assistant" || /^\/assistant\/(?!summaries|qcm|analysis)/.test(path) : path.startsWith(x.href);
            return (
              <Link key={x.href} href={x.href} aria-current={active ? "page" : undefined} className={`btn btn-sm ${active ? "btn-primary" : ""}`}>
                {t(x.key)}
              </Link>
            );
          })}
        </nav>
      </div>
      {pressured && <p role="status" className="rounded-xl bg-surface-2 p-2.5 text-xs text-muted">{t("ai.pressure")}</p>}
    </div>
  );
}
