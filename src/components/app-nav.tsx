"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, CalendarDays, Dumbbell, Home, Library, ShieldCheck } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";

const ITEMS: { href: string; key: DictKey; icon: typeof Home }[] = [
  { href: "/", key: "nav.home", icon: Home },
  { href: "/subjects", key: "nav.subjects", icon: Library },
  { href: "/practice", key: "nav.practice", icon: Dumbbell },
  { href: "/assistant", key: "nav.assistant", icon: Bot },
  { href: "/schedule", key: "nav.schedule", icon: CalendarDays },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function SideNav({ isStaff }: { isStaff: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  const items = isStaff
    ? [...ITEMS, { href: "/admin", key: "admin.title" as DictKey, icon: ShieldCheck }]
    : ITEMS;
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-10 items-center gap-3 rounded-[var(--radius)] px-3 text-sm font-medium transition-colors ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <Icon size={18} aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav() {
  const { t } = useT();
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-border bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {ITEMS.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${
              active ? "text-accent" : "text-muted"
            }`}
          >
            <Icon size={20} aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
