import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClaySheet({ width = 30, height = 32, className }: ClayProps) {
  const u = useUid("sh");
  return (
    <svg width={width} height={height} viewBox="0 0 36 40" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${u}A`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#D4F2E5" /></linearGradient>
        <radialGradient id={`${u}B`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#A6F2D1" /><stop offset="1" stopColor="#139466" /></radialGradient>
      </defs>
      <rect x="7" y="5" width="26" height="33" rx="6" fill="#A8DCC6" />
      <rect x="3" y="2" width="26" height="33" rx="6" fill={`url(#${u}A)`} />
      <rect x="8" y="9" width="16" height="3.5" rx="1.75" fill="#139466" />
      <rect x="8" y="16" width="12" height="3" rx="1.5" fill="#7FCFAE" />
      <rect x="8" y="22" width="14" height="3" rx="1.5" fill="#7FCFAE" />
      <circle cx="27" cy="31" r="7" fill={`url(#${u}B)`} />
      <path d="M24 31l2 2 4-4" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
