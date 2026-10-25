"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LayeredN } from "@/components/clay";
import { useT } from "@/lib/i18n/client";

/** شاشة البداية (VSplash.html): مرة واحدة عند فتح التطبيق (لكل جلسة متصفح)، بحد أقصى 2.5 ثانية، ولمسة تتخطّاها. */
const KEY = "neuron-splash";
let dismissed = false;
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => void listeners.delete(cb);
};
const snapshot = () => {
  if (dismissed) return false;
  try {
    return sessionStorage.getItem(KEY) !== "1";
  } catch {
    return true;
  }
};
function dismiss() {
  dismissed = true;
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* بلا تخزين: تُخفى لهذه الصفحة فقط */
  }
  listeners.forEach((l) => l());
}

export function Splash() {
  const { t } = useT();
  const show = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(dismiss, 2500);
    return () => clearTimeout(id);
  }, [show]);
  if (!show) return null;
  return (
    <div
      role="dialog"
      aria-label="Neuron"
      onClick={dismiss}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-[34px] overflow-hidden bg-celebrate text-white"
    >
      <svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true" className="absolute inset-0 size-full">
        <g stroke="#5A3BB8" strokeWidth="1.5" fill="none" opacity="0.8">
          <path className="v-sig" d="M30 160 L120 250 L60 330" />
          <path className="v-sig v-s2" d="M360 120 L280 230 L340 320" />
          <path className="v-sig v-s3" d="M40 640 L130 560 L70 480" />
          <path className="v-sig v-s4" d="M350 700 L270 600 L330 520" />
        </g>
        <g fill="#8B66FF">
          <circle cx="30" cy="160" r="3" /><circle cx="120" cy="250" r="4" /><circle cx="60" cy="330" r="3" />
          <circle cx="360" cy="120" r="3" /><circle cx="280" cy="230" r="4" /><circle cx="340" cy="320" r="3" />
          <circle cx="40" cy="640" r="3" /><circle cx="130" cy="560" r="4" /><circle cx="70" cy="480" r="3" />
          <circle cx="350" cy="700" r="3" /><circle cx="270" cy="600" r="4" /><circle cx="330" cy="520" r="3" />
        </g>
      </svg>

      <div className="v-stage relative flex items-center justify-center">
        <div className="v-glow absolute size-[230px] rounded-full bg-[#3A1A9E]" />
        <LayeredN variant="splash" label={t("login.logoAlt")} pulse />
      </div>

      <div className="v-fade flex flex-col items-center gap-1.5">
        <span className="text-[34px] font-bold tracking-[0.02em]">Neuron</span>
        <span className="text-[15px] text-on-dark-3">{t("splash.tagline")}</span>
      </div>

      <div className="h-1 w-[120px] overflow-hidden rounded-sm bg-[#3A1A9E]">
        <div className="v-bar h-1 w-full rounded-sm bg-white" />
      </div>

      <button type="button" onClick={dismiss} className="absolute bottom-9 border-0 bg-transparent font-[inherit] text-[13px] text-[#C4B2FF]">
        {t("splash.skip")}
      </button>
    </div>
  );
}
