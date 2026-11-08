/**
 * Five-layer N logo at Z depth.
 * splash: 150px, layers -24/-18/-12/-6/0 (VSplash). login: 140px, -20/-14/-8/-3/0 (Login).
 * The frame (perspective + animation) is handled by the caller via the inner container's className.
 */
type Layer = { z: number; stroke: string; r: number; w: number; fill?: string };

const SPLASH: Layer[] = [
  { z: -24, stroke: "#3A1A9E", r: 3, w: 3.6 },
  { z: -18, stroke: "#4A22C4", r: 3, w: 3.6 },
  { z: -12, stroke: "#5A2EE0", r: 3, w: 3.6 },
  { z: -6, stroke: "#6D3BF5", r: 3, w: 3.6 },
];
const LOGIN: Layer[] = [
  { z: -20, stroke: "#2A0E6E", r: 3.2, w: 3.8 },
  { z: -14, stroke: "#3A1A9E", r: 3.2, w: 3.8 },
  { z: -8, stroke: "#4A22C4", r: 3.2, w: 3.8 },
  { z: -3, stroke: "#5A2EE0", r: 3.2, w: 3.8 },
];
const N = "M9 23V9l14 14V9";

export function LayeredN({ variant, label, pulse = false }: { variant: "splash" | "login"; label: string; pulse?: boolean }) {
  const layers = variant === "splash" ? SPLASH : LOGIN;
  const size = variant === "splash" ? 150 : 140;
  return (
    <div className={variant === "splash" ? "v-logo" : "nlogo"} role="img" aria-label={label} style={{ position: "relative", width: size, height: size, transformStyle: "preserve-3d" }}>
      {layers.map((l) => (
        <svg key={l.z} className="v-layer" style={{ transform: `translateZ(${l.z}px)` }} viewBox="0 0 32 32" aria-hidden="true">
          <path d={N} fill="none" stroke={l.stroke} strokeWidth={l.w} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="9" r={l.r} fill={l.stroke} />
          <circle cx="23" cy="23" r={l.r} fill={l.stroke} />
        </svg>
      ))}
      {variant === "splash" ? (
        <svg className="v-layer" viewBox="0 0 32 32" aria-hidden="true">
          <path d={N} fill="none" stroke="#FFFFFF" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
          {pulse && (<>
            <circle className="v-pulse" cx="9" cy="9" r="3" fill="#FFB547" />
            <circle className="v-pulse" cx="23" cy="23" r="3" fill="#FFB547" />
          </>)}
          <circle cx="9" cy="9" r="2.6" fill="#FFB547" />
          <circle cx="23" cy="23" r="2.6" fill="#FFB547" />
        </svg>
      ) : (
        <svg className="v-layer" viewBox="0 0 32 32" aria-hidden="true">
          <path d={N} fill="none" stroke="#8B66FF" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="9" cy="9" r="3" fill="#FFB547" />
          <circle cx="23" cy="23" r="3" fill="#FFB547" />
        </svg>
      )}
    </div>
  );
}
