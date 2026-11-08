"use client";

import { useEffect, useRef } from "react";
import { ClayBook, ClayBulb, ClayCap, LayeredN } from "@/components/clay";
import { useT } from "@/lib/i18n/client";

/**
 * Login scene (Login.html): a five-layer N logo in the center with a floating cap, book and lamp,
 * moving with a parallax effect following the pointer (far 6 / mid 12 / near 20) and the phone's tilt.
 * Updates go through two CSS variables (--px/--py), with no React re-render.
 */
export function LoginShell({ lang, title, subtitle, children }: { lang: React.ReactNode; title: string; subtitle: string; children: React.ReactNode }) {
  const { t } = useT();
  const root = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const set = (x: number, y: number) => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      root.current?.style.setProperty("--px", x.toFixed(3));
      root.current?.style.setProperty("--py", y.toFixed(3));
    });
  };

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof DeviceOrientationEvent === "undefined") return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      set(clamp(e.gamma / 35), clamp((e.beta - 45) / 35));
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const r = e.currentTarget.getBoundingClientRect();
    set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
  };
  const onDown = () => {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === "function") D.requestPermission().catch(() => {});
  };
  const shift = (d: number) => ({ transform: `translate(calc(var(--px, 0) * ${d}px), calc(var(--py, 0) * ${d}px))` });

  return (
    <div ref={root} onPointerMove={onMove} onPointerLeave={() => set(0, 0)} onPointerDown={onDown} className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col overflow-hidden bg-bg">
      <div className="relative h-[430px] shrink-0">
        <div className="absolute end-4 top-4 z-10 rounded-[14px] bg-surface">{lang}</div>
        <div className="plx absolute right-[34px] top-16" style={shift(6)}>
          <div className="bob"><ClayCap variant="login" /></div>
        </div>
        <div className="plx absolute left-[30px] top-24" style={shift(12)}>
          <div className="bob2"><ClayBook variant="violet" /></div>
        </div>
        <div className="plx absolute right-[26px] top-[262px]" style={shift(12)}>
          <div className="bob3"><ClayBulb /></div>
        </div>
        <div className="plx absolute left-1/2 top-40 -ml-[70px]" style={shift(20)}>
          <div style={{ perspective: 600 }}>
            <LayeredN variant="login" label={t("login.logoAlt")} />
          </div>
        </div>
      </div>

      <section className="flex grow flex-col gap-3.5 rounded-t-[30px] bg-surface px-[22px] pb-[30px] pt-[26px] shadow-[0_-10px_30px_rgba(42,14,110,0.08)]">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 text-2xl font-bold">{title}</h1>
          <p className="m-0 text-sm text-muted">{subtitle}</p>
        </div>
        {children}
      </section>
    </div>
  );
}
