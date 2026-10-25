import { useUid } from "./uid";
import type { ClayProps } from "./types";

export function ClayPencil({ width = 32, height = 32, className }: ClayProps) {
  const u = useUid("pen");
  return (
    <svg width={width} height={height} viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <defs><linearGradient id={`${u}G`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#FFE08A" /><stop offset="1" stopColor="#E9971A" /></linearGradient></defs>
      <g transform="rotate(45 20 20)">
        <rect x="15" y="2" width="10" height="7" rx="3" fill="#FF8DB2" />
        <rect x="15" y="8" width="10" height="3.5" fill="#C9BDF5" />
        <rect x="15" y="11" width="10" height="18" fill={`url(#${u}G)`} />
        <rect x="16.5" y="12" width="2.5" height="16" fill="#FFFFFF" opacity="0.45" />
        <path d="M15 29 L20 38 L25 29 Z" fill="#FFE3C2" />
        <path d="M18.6 35.4 L20 38 L21.4 35.4 Z" fill="#2A0E6E" />
      </g>
    </svg>
  );
}
