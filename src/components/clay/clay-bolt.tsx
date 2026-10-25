import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayBolt({ width = 26, height = 32, className }: ClayProps) {
  const u = useUid("bolt");
  return (
    <svg width={width} height={height} viewBox="0 0 32 40" aria-hidden="true" className={className}>
      <defs><radialGradient id={`${u}G`} cx="35%" cy="20%" r="90%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="0.5" stopColor="#FFB547" /><stop offset="1" stopColor="#E07B0A" /></radialGradient></defs>
      <path d="M19 2 L4 23 H15 L12 38 L28 15 H17 Z" fill={`url(#${u}G)`} stroke="#E9971A" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M17 7 L9 19" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
