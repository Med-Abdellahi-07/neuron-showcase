import { useUid } from "./uid";
import type { ClayProps } from "./types";

/** Clock with a rotating hand (class phand defined in globals.css). */
export function ClayClock({ width = 72, height = 72, className }: ClayProps) {
  const u = useUid("clk");
  return (
    <svg width={width} height={height} viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={`${u}F`} cx="34%" cy="28%" r="80%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D9CCFF" /></radialGradient>
        <radialGradient id={`${u}R`} cx="35%" cy="25%" r="85%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="1" stopColor="#E9971A" /></radialGradient>
      </defs>
      <rect x="18" y="4" width="12" height="9" rx="4" fill="#FF6B9A" transform="rotate(-25 24 8)" />
      <rect x="50" y="4" width="12" height="9" rx="4" fill="#FF6B9A" transform="rotate(25 56 8)" />
      <circle cx="40" cy="40" r="32" fill={`url(#${u}R)`} />
      <circle cx="40" cy="40" r="25" fill={`url(#${u}F)`} />
      <path d="M40 40 V24" stroke="#2A0E6E" strokeWidth="4" strokeLinecap="round" />
      <g className="phand"><path d="M40 40 L52 46" stroke="#6D3BF5" strokeWidth="3.5" strokeLinecap="round" /></g>
      <circle cx="40" cy="40" r="3.5" fill="#2A0E6E" />
    </svg>
  );
}
