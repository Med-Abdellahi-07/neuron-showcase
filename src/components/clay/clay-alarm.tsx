import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayAlarm({ width = 48, height = 52, className }: ClayProps) {
  const u = useUid("al");
  return (
    <svg width={width} height={height} viewBox="0 0 48 52" aria-hidden="true" className={className}>
      <defs><radialGradient id={`${u}G`} cx="34%" cy="28%" r="80%"><stop offset="0" stopColor="#FFC2D6" /><stop offset="1" stopColor="#E84A80" /></radialGradient></defs>
      <circle cx="11" cy="9" r="7" fill="#FFB547" /><circle cx="37" cy="9" r="7" fill="#FFB547" />
      <path d="M12 46 L8 50 M36 46 L40 50" stroke="#C23B6C" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="24" cy="28" r="19" fill={`url(#${u}G)`} />
      <circle cx="24" cy="28" r="13" fill="#FFFFFF" />
      <path d="M24 28 V20 M24 28 L29 31" stroke="#2A0E6E" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
