"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/client";
import { parentPath } from "@/lib/nav";

/**
 * Back arrow in the header of every inner page (the installed app has no browser buttons). Follows text direction: left in LTR, right in RTL.
 * If the student navigated inside the app it goes back; if the page was opened directly (notification/link) it goes to the parent page.
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
 {/* Path copied from the design files (points right = back in RTL), flipped in LTR. */}
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="ltr:-scale-x-100">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </button>
  );
}
