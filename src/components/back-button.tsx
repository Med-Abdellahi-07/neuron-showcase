"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { parentPath } from "@/lib/nav";

/**
 * سهم رجوع في رأس كل صفحة داخلية (التطبيق المثبّت بلا أزرار متصفح). يتبع اتجاه اللغة: ← في LTR و→ في RTL.
 * إن تنقّل الطالب داخل التطبيق يرجع للصفحة السابقة فعلاً؛ وإن فتح الصفحة مباشرة (إشعار/رابط) يذهب للصفحة الأم.
 */
export function BackButton() {
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
      className="press flex size-10 items-center justify-center rounded-2xl bg-surface text-fg shadow-[var(--shadow)]"
    >
      <ArrowLeft size={18} aria-hidden className="rtl:hidden" />
      <ArrowRight size={18} aria-hidden className="hidden rtl:block" />
    </button>
  );
}
