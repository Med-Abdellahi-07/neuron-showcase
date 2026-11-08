"use client";

import type { ReactNode } from "react";
import { useT } from "@/lib/i18n/client";

/** Button inside a <form> that asks for confirmation before submitting. */
export function ConfirmButton({ children, className = "btn btn-sm btn-danger" }: { children: ReactNode; className?: string }) {
  const { t } = useT();
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(t("common.confirm"))) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
