import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayBars({ width = 62, height = 58, className }: ClayProps) {
  const u = useUid("bar");
  return (
    <svg width={width} height={height} viewBox="0 0 62 58" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${u}1`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#E2D8FF" /><stop offset="1" stopColor="#B49CFF" /></linearGradient>
        <linearGradient id={`${u}2`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#B49CFF" /><stop offset="1" stopColor="#7C5CE6" /></linearGradient>
        <linearGradient id={`${u}3`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#8B66FF" /><stop offset="1" stopColor="#4A22C4" /></linearGradient>
        <radialGradient id={`${u}Ar`} cx="35%" cy="25%" r="85%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="1" stopColor="#E9971A" /></radialGradient>
      </defs>
      <ellipse cx="31" cy="53" rx="24" ry="3.5" fill="#2A0E6E" opacity="0.12" />
      <rect x="8" y="32" width="12" height="20" rx="5" fill={`url(#${u}1)`} />
      <rect x="25" y="22" width="12" height="30" rx="5" fill={`url(#${u}2)`} />
      <rect x="42" y="12" width="12" height="40" rx="5" fill={`url(#${u}3)`} />
      <path d="M6 24 L22 14 L32 18 L50 4" fill="none" stroke={`url(#${u}Ar)`} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M43 3 L52 2.5 L51 11" fill="none" stroke="#E9971A" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
