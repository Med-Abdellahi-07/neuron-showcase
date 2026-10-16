"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";

const TABS: { href: string; key: DictKey; adminOnly?: boolean }[] = [
  { href: "/admin", key: "admin.stats" },
  { href: "/admin/content", key: "admin.content" },
  { href: "/admin/questions", key: "admin.questionsMenu" },
  { href: "/admin/schedule", key: "admin.scheduleMenu" },
  { href: "/admin/approvals", key: "admin.approvals", adminOnly: true },
  { href: "/admin/announcements", key: "admin.announcements", adminOnly: true },
  { href: "/admin/ai", key: "admin.aiMenu", adminOnly: true },
  { href: "/admin/accounts", key: "admin.accountsMenu", adminOnly: true },
];

export function AdminTabs({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  return (
    <nav aria-label="Admin" className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-1.5">
        {TABS.filter((x) => isAdmin || !x.adminOnly).map(({ href, key }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium whitespace-nowrap ${
                  active ? "border-transparent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"
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
