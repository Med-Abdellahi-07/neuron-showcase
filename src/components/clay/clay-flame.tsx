import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayFlame({ width = 58, height = 62, className }: ClayProps) {
  const u = useUid("fl");
  return (
    <svg width={width} height={height} viewBox="0 0 24 26" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={`${u}A`} cx="40%" cy="70%" r="80%"><stop offset="0" stopColor="#FFE08A" /><stop offset="0.55" stopColor="#FFA23D" /><stop offset="1" stopColor="#FF5E7A" /></radialGradient>
        <radialGradient id={`${u}In`} cx="45%" cy="40%" r="70%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#FFD36B" /></radialGradient>
      </defs>
      <path d="M12 2c1.2 4 5.5 5.2 5.5 10.5A5.5 5.5 0 0 1 6.5 12.5c0-2.2 1-3.6 2.2-4.6 0 2 1 3.3 2.3 3.3 0-3.4-2-5.6 1-9.2z" fill={`url(#${u}A)`} />
      <path d="M12 13c.6 1.6 2.4 2.2 2.4 4.2a2.4 2.4 0 0 1-4.8 0c0-1.2.8-2 2.4-4.2z" fill={`url(#${u}In)`} />
      <path d="M9.2 9.6 Q8.4 11 8.6 12.6" fill="none" stroke="#FFFFFF" strokeWidth="0.9" strokeLinecap="round" opacity="0.6" />
      <ellipse cx="12" cy="24.6" rx="5" ry="1" fill="#2A0E6E" opacity="0.35" />
    </svg>
  );
}
