import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayBulb({ width = 70, height = 92, className }: ClayProps) {
  const u = useUid("bulb");
  return (
    <svg width={width} height={height} viewBox="0 0 70 92" aria-hidden="true" className={className}>
      <defs><radialGradient id={`${u}G`} cx="38%" cy="32%" r="75%"><stop offset="0" stopColor="#FFF4C7" /><stop offset="1" stopColor="#FFB547" /></radialGradient></defs>
      <circle cx="35" cy="34" r="28" fill={`url(#${u}G)`} />
      <rect x="22" y="58" width="26" height="12" rx="4" fill="#C9CEDD" />
      <rect x="24" y="70" width="22" height="10" rx="4" fill="#AEB4C6" />
      <path d="M28 40 Q35 26 42 40" fill="none" stroke="#C8851E" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
