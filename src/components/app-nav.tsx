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

/* أيقونات الشريط السفلي منسوخة من VHome / VSchedule: نشط = ملوّن بالبنفسجي (الرئيسية والجدول مملوءتان) */
function NavIcon({ href, active }: { href: string; active: boolean }) {
  const common = { width: 24, height: 24, viewBox: "0 0 24 24", "aria-hidden": true } as const;
  switch (href) {
    case "/":
      return active ? (
        <svg {...common} fill="currentColor"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
      ) : (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /></svg>
      );
    case "/subjects":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round"><path d="M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" /><path d="M5 18a2 2 0 0 1 2-2h12" /></svg>
      );
    case "/practice":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /></svg>
      );
    case "/schedule":
      return active ? (
        <svg {...common} fill="currentColor"><path d="M7 3a1 1 0 0 1 1 1v1h8V4a1 1 0 1 1 2 0v1h1a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h1V4a1 1 0 0 1 1-1zM4 11v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7z" /></svg>
      ) : (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
      );
    default:
      return null;
  }
}

/** الشريط السفلي: 5 عناصر، ووسطها زر المساعد المرفوع (62px، حدّ 5px بلون الخلفية، margin-top −34px) */
export function BottomNav({ ai }: { ai: boolean }) {
  const { t } = useT();
  const pathname = usePathname();
  const base = ITEMS.filter((i) => i.href !== "/assistant");
  // الترتيب: الرئيسية، المواد، [المساعد]، تدرّب، الجدول
  // الصفحة الرئيسية للمساعد تضع شريط السؤال في أسفل الشاشة بدل التنقل (كما في VAssistant)
  if (pathname === "/assistant") return null;
  const items = ai ? [base[0], base[1], ITEMS.find((i) => i.href === "/assistant")!, base[2], base[3]] : base;
  return (
    <nav
      aria-label="Main"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, height: "calc(84px + env(safe-area-inset-bottom))" }}
      className="fixed inset-x-0 bottom-0 z-20 grid items-start rounded-t-[var(--r-nav)] bg-nav pt-3 shadow-[0_-8px_24px_rgba(42,14,110,0.06)] md:hidden"
    >
      {items.map(({ href, key }) => {
        const active = isActive(pathname, href);
        if (href === "/assistant") {
          return (
            <Link key={href} href={href} aria-label={t(key)} aria-current={active ? "page" : undefined} className="press -mt-[34px] flex justify-center">
              <span className="flex size-[62px] items-center justify-center rounded-full border-[5px] border-bg bg-primary text-white shadow-[var(--shadow-fab)]">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8z" />
                  <path d="M19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9z" />
                </svg>
              </span>
            </Link>
          );
        }
        return (
          <Link
            key={href}
            href={href}
            aria-label={t(key)}
            aria-current={active ? "page" : undefined}
            className={`press flex justify-center ${active ? "text-accent" : "text-faint"}`}
          >
            <NavIcon href={href} active={active} />
          </Link>
        );
      })}
    </nav>
  );
}
