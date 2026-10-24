"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sparkles } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export interface AiTab {
  href: string;
  key: "ai.tab.chat" | "ai.tab.summaries" | "ai.tab.qcm";
}

/** شريط أقسام الذكاء الاصطناعي + عدّاد النقاط اليومي («تبقى لك اليوم X») */
export function AiTabs({ tabs, remaining, limit, pressured }: { tabs: AiTab[]; remaining: number; limit: number; pressured: boolean }) {
  const { t } = useT();
  const path = usePathname();
  const low = limit > 0 && remaining / limit <= 0.2;
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
        <p className={`tech inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs ${low ? "bg-urgent-bg text-urgent" : "bg-surface-2 text-muted"}`} role="status">
          <Sparkles size={12} aria-hidden /> {t("ai.counter").replace("{n}", String(remaining))}
        </p>
      </div>
      {pressured && <p role="status" className="rounded-xl bg-surface-2 p-2.5 text-xs text-muted">{t("ai.pressure")}</p>}
    </div>
  );
}
