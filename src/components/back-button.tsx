"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { parentPath } from "@/lib/nav";

/**
 * سهم رجوع في رأس كل صفحة داخلية (التطبيق المثبّت بلا أزرار متصفح). يتبع اتجاه اللغة: ← في LTR و→ في RTL.
 * إن تنقّل الطالب داخل التطبيق يرجع للصفحة السابقة فعلاً؛ وإن فتح الصفحة مباشرة (إشعار/رابط) يذهب للصفحة الأم.
 */
export function BackButton({ variant = "light" }: { variant?: "light" | "dark" }) {
  const { t } = useT();
  const path = usePathname();
  const router = useRouter();
  const navs = useRef(0);
  const last = useRef(path);
  useEffect(() => {
    if (last.current !== path) {
      navs.current += 1;
      last.current = path;
    }
  }, [path]);
  if (path === "/") return null;
  return (
    <button
      type="button"
      onClick={() => (navs.current > 0 ? router.back() : router.push(parentPath(path)))}
      aria-label={t("nav.back")}
      className={`press flex items-center justify-center rounded-[14px] ${variant === "dark" ? "size-10 bg-deep-2 text-white" : "size-[42px] bg-surface text-fg"}`}
    >
      {/* المسار منسوخ من ملفات التصميم (يشير يميناً = رجوع في RTL)، ويُقلب في LTR */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ltr:-scale-x-100">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
