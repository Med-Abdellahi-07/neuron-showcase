import { useUid } from "./uid";
import type { ClayProps } from "./types";

/** tile = أيقونة الجدول (وردية) في الرئيسية، hero = التقويم الكبير في صفحة الجدول */
export function ClayCalendar({ variant = "tile", day = "27", width, height, className }: ClayProps & { variant?: "tile" | "hero"; day?: string }) {
  const u = useUid("cal");
  if (variant === "hero") {
    return (
      <svg width={width ?? 96} height={height ?? 96} viewBox="0 0 96 96" aria-hidden="true" className={className}>
        <defs>
          <linearGradient id={`${u}A`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#DCD0FF" /></linearGradient>
          <linearGradient id={`${u}T`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9B7BFF" /><stop offset="1" stopColor="#5A2EE0" /></linearGradient>
          <linearGradient id={`${u}R`} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FFF0B8" /><stop offset="1" stopColor="#E9971A" /></linearGradient>
        </defs>
        <rect x="10" y="18" width="76" height="70" rx="18" fill="#B9A6F2" />
        <rect x="10" y="14" width="76" height="70" rx="18" fill={`url(#${u}A)`} />
        <path d="M10 36 V32 a18 18 0 0 1 18-18 H68 a18 18 0 0 1 18 18 V36 Z" fill={`url(#${u}T)`} />
        <rect x="26" y="6" width="9" height="20" rx="4.5" fill={`url(#${u}R)`} />
        <rect x="61" y="6" width="9" height="20" rx="4.5" fill={`url(#${u}R)`} />
        <text x="48" y="72" fontFamily="Readex Pro, sans-serif" fontSize="30" fontWeight="700" fill="#2A0E6E" textAnchor="middle">{day}</text>
        <path d="M18 44 Q20 40 26 40" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width={width ?? 30} height={height ?? 30} viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={`${u}A`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E7DEFF" /></linearGradient>
        <linearGradient id={`${u}T`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#FF8DB2" /><stop offset="1" stopColor="#E84A80" /></linearGradient>
      </defs>
      <rect x="4" y="7" width="32" height="30" rx="8" fill={`url(#${u}A)`} />
      <path d="M4 15 V14 a7 7 0 0 1 7-7 H29 a7 7 0 0 1 7 7 V16 H4 Z" fill={`url(#${u}T)`} />
      <rect x="11" y="3" width="4" height="9" rx="2" fill="#6D3BF5" />
      <rect x="25" y="3" width="4" height="9" rx="2" fill="#6D3BF5" />
      <text x="20" y="32" fontFamily="Readex Pro, sans-serif" fontSize="13" fontWeight="700" fill="#2A0E6E" textAnchor="middle">{day}</text>
    </svg>
  );
}
