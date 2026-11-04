"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";
import type { Feature } from "@/lib/space-model";

type Level = "staff" | "manager" | "admin";
const TABS: { href: string; key: DictKey; level: Level; feature?: Feature }[] = [
  { href: "/admin", key: "admin.stats", level: "staff" },
  { href: "/admin/content", key: "admin.content", level: "staff" },
  { href: "/admin/questions", key: "admin.questionsMenu", level: "staff" },
  { href: "/admin/students", key: "admin.studentsMenu", level: "manager" },
  { href: "/admin/subjects", key: "admin.subjectsMenu", level: "manager" },
  { href: "/admin/schedule", key: "admin.scheduleMenu", level: "staff" },
  { href: "/admin/recordings", key: "admin.recordings", level: "staff", feature: "recordings" },
  { href: "/admin/approvals", key: "admin.approvals", level: "manager" },
  { href: "/admin/announcements", key: "admin.announcements", level: "manager" },
  { href: "/admin/notifications", key: "admin.notifications", level: "admin" },
  { href: "/admin/ai", key: "admin.aiMenu", level: "admin", feature: "ai" },
  { href: "/admin/accounts", key: "admin.accountsMenu", level: "admin" },
  { href: "/admin/spaces", key: "admin.spacesMenu", level: "admin" },
];

export function AdminTabs({ role, features, multiSpace = false }: { role: "moderator" | "space_admin" | "admin"; features: Partial<Record<Feature, boolean>>; multiSpace?: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  const rank = role === "admin" ? 3 : role === "space_admin" ? 2 : 1;
  const need: Record<Level, number> = { staff: 1, manager: 2, admin: 3 };
  const tabs = TABS.filter((x) => rank >= need[x.level] && (multiSpace || x.href !== "/admin/spaces") && (!x.feature || features[x.feature]));
  return (
    <nav aria-label="Admin" className="-mx-4 mb-5 overflow-x-auto px-4 md:mx-0 md:px-0">
      <ul className="flex w-max gap-1.5">
        {tabs.map(({ href, key }) => {
          const active = href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
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
