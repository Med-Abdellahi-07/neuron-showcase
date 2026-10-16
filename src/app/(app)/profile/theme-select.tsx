"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { useT } from "@/lib/i18n/client";

const OPTIONS = [
  { value: "light", icon: Sun, key: "theme.light" },
  { value: "dark", icon: Moon, key: "theme.dark" },
  { value: "system", icon: Monitor, key: "theme.system" },
] as const;

export function ThemeSelect() {
  const { t } = useT();
  const { theme, setTheme } = useTheme();
  // false أثناء الـ SSR وtrue في المتصفح — يتجنب اختلاف الـ hydration مع next-themes
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  return (
    <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("profile.theme")}>
      {OPTIONS.map(({ value, icon: Icon, key }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(value)}
            className={`btn flex-col !gap-1 py-2 text-xs ${active ? "!border-accent !bg-accent-soft !text-accent" : ""}`}
          >
            <Icon size={18} aria-hidden />
            {t(key)}
          </button>
        );
      })}
    </div>
  );
}
