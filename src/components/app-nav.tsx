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

/** عناصر التنقل تتكيّف مع ميزات الفضاء: بلا ذكاء اصطناعي ← يختفي «المساعد» */
const itemsFor = (ai: boolean) => ITEMS.filter((i) => ai || i.href !== "/assistant");

export function SideNav({ isStaff, ai }: { isStaff: boolean; ai: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  const base = itemsFor(ai);
  const items = isStaff ? [...base, { href: "/admin", key: "admin.title" as DictKey, icon: ShieldCheck }] : base;
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {items.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-2xl px-3 text-sm font-medium transition-colors duration-[var(--t)] ${
              active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <Icon size={18} strokeWidth={1.9} aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

export function BottomNav({ ai }: { ai: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  const items = itemsFor(ai);
  return (
    <nav
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 grid rounded-[28px] bg-nav px-1.5 py-2.5 shadow-[0_8px_24px_rgba(30,45,90,0.12)] dark:shadow-none md:hidden"
    >
      {items.map(({ href, key, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="press flex min-h-[3.25rem] flex-col items-center justify-center gap-1 text-[11px] font-medium"
          >
            <span
              className={`flex h-[30px] w-11 items-center justify-center rounded-full transition-colors duration-[var(--t)] ${
                active ? "bg-accent-soft text-accent" : "text-muted"
              }`}
            >
              <Icon size={22} strokeWidth={1.9} aria-hidden />
            </span>
            <span className={active ? "text-accent" : "text-muted"}>{t(key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
