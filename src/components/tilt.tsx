"use client";

import { useEffect, useRef } from "react";

/**
 * Card that tilts on touch or pointer move (Tilt3D.html): rotateX/rotateY up to +-9deg/+-7deg with scale(1.02),
 * and a circular light reflection following the finger. On phones it also tilts with device motion (gyro).
 * Motion uses transform/opacity only and is disabled under prefers-reduced-motion.
 */
export function Tilt({
  children,
  className = "",
  glow = "rgba(109,59,245,0.35)",
}: {
  children: React.ReactNode;
  className?: string;
  /** Elevation shadow color on touch. */
  glow?: string;
}) {
  const card = useRef<HTMLDivElement>(null);
  const shine = useRef<HTMLSpanElement>(null);
  const active = useRef(false);
  const reduce = useRef(false);
  const raf = useRef(0);

  const apply = (rx: number, ry: number, on: boolean, sx = 0, sy = 0) => {
    const el = card.current;
    if (!el) return;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      el.style.transform = on || rx || ry ? `rotateX(${rx.toFixed(1)}deg) rotateY(${ry.toFixed(1)}deg)${on ? " scale(1.02)" : ""}` : "";
      el.style.boxShadow = on ? `0 24px 40px ${glow}` : "";
      if (shine.current) {
        shine.current.style.opacity = on ? "0.16" : "0";
        shine.current.style.transform = `translate(${(sx - 110).toFixed(0)}px, ${(sy - 110).toFixed(0)}px)`;
      }
    });
  };

  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce.current || typeof DeviceOrientationEvent === "undefined") return;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    const onOrient = (e: DeviceOrientationEvent) => {
      if (active.current || e.gamma == null || e.beta == null) return;
      apply(-clamp((e.beta - 45) / 45) * 7, clamp(e.gamma / 45) * 9, false);
    };
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("deviceorientation", onOrient);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduce.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    active.current = true;
    apply((0.5 - py) * 14, (px - 0.5) * 18, true, e.clientX - r.left, e.clientY - r.top);
  };
  const onLeave = () => {
    active.current = false;
    apply(0, 0, false);
  };
  // iOS requires explicit permission to read the sensor, and only from a user gesture.
  const onDown = () => {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D.requestPermission === "function") D.requestPermission().catch(() => {});
  };

  return (
    <div style={{ perspective: 700 }}>
      <div
        ref={card}
        onPointerMove={onMove}
        onPointerLeave={onLeave}
        onPointerUp={onLeave}
        onPointerCancel={onLeave}
        onPointerDown={onDown}
        className={`tilt relative overflow-hidden ${className}`}
        style={{ transformStyle: "preserve-3d" }}
      >
        <span
          ref={shine}
          aria-hidden="true"
          className="pointer-events-none absolute size-[220px] rounded-full bg-white opacity-0 transition-opacity"
          style={{ left: 0, top: 0, opacity: 0, mixBlendMode: "normal" }}
        />
        {children}
      </div>
    </div>
  );
}
