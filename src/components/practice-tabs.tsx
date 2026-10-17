"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";

const TABS: { href: string; key: DictKey }[] = [
  { href: "/practice", key: "arena.tab.train" },
  { href: "/practice/duel", key: "duel.tab" },
  { href: "/practice/leaderboard", key: "arena.tab.ranking" },
  { href: "/practice/mistakes", key: "arena.tab.mistakes" },
];

export function PracticeTabs() {
  const { t } = useT();
  const pathname = usePathname();
  return (
    <nav aria-label={t("nav.practice")} className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-1.5">
        {TABS.map(({ href, key }) => {
          const active = href === "/practice" ? pathname === href : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap ${
                  active ? "border-transparent bg-primary text-primary-fg" : "border-border text-muted hover:text-fg"
                }`}
              >
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
