import { useUid } from "./uid";
import type { ClayProps } from "./types";

/** ring = كرة خضراء (تقدّمي)، tile = أيقونة QCM في الرئيسية، quiz = «ولّد لي QCM» */
export function ClayCheck({ variant = "ring", width, height, className }: ClayProps & { variant?: "ring" | "tile" | "quiz" }) {
  const u = useUid("chk");
  if (variant === "tile") {
    return (
      <svg width={width ?? 30} height={height ?? 30} viewBox="0 0 40 40" aria-hidden="true" className={className}>
        <defs><radialGradient id={`${u}G`} cx="32%" cy="25%" r="85%"><stop offset="0" stopColor="#A6F2D1" /><stop offset="1" stopColor="#139466" /></radialGradient></defs>
        <rect x="4" y="4" width="32" height="32" rx="10" fill={`url(#${u}G)`} />
        <path d="M9 9 Q14 6 22 7" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <path d="M12 20.5l5.5 5.5L28 14.5" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (variant === "quiz") {
    return (
      <svg width={width ?? 32} height={height ?? 32} viewBox="0 0 40 40" aria-hidden="true" className={className}>
        <defs><radialGradient id={`${u}G`} cx="32%" cy="25%" r="85%"><stop offset="0" stopColor="#C4B2FF" /><stop offset="1" stopColor="#5A2EE0" /></radialGradient></defs>
        <rect x="8" y="2" width="28" height="28" rx="9" fill="#D9CCFF" />
        <rect x="3" y="8" width="30" height="30" rx="10" fill={`url(#${u}G)`} />
        <path d="M8 13 Q13 10 20 11" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.5" />
        <path d="M10.5 23.5l5 5L26 18" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={width ?? 72} height={height ?? 72} viewBox="0 0 80 80" aria-hidden="true" className={className}>
      <defs><radialGradient id={`${u}G`} cx="32%" cy="26%" r="80%"><stop offset="0" stopColor="#B8F7DC" /><stop offset="0.55" stopColor="#3CCB92" /><stop offset="1" stopColor="#0E7A52" /></radialGradient></defs>
      <circle cx="40" cy="40" r="32" fill={`url(#${u}G)`} />
      <path d="M20 28 Q28 16 42 15" fill="none" stroke="#FFFFFF" strokeWidth="4" strokeLinecap="round" opacity="0.45" />
      <path d="M26 41l10 10 19-20" fill="none" stroke="#FFFFFF" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
