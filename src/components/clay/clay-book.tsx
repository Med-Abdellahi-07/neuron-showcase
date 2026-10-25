import { useUid } from "./uid";
import type { ClayProps } from "./types";

/**
 * كتاب. gold = رأس الرئيسية، violet = الدخول، tile = أيقونة «الدروس»،
 * tileDot = أيقونة «اشرح الدرس» في المساعد (مع دائرة ذهبية).
 */
export function ClayBook({ variant = "gold", width, height, className }: ClayProps & { variant?: "gold" | "violet" | "tile" | "tileDot" }) {
  const u = useUid("book");
  if (variant === "violet") {
    return (
      <svg width={width ?? 96} height={height ?? 86} viewBox="0 0 96 86" aria-hidden="true" className={className}>
        <defs><radialGradient id={`${u}G`} cx="30%" cy="25%" r="85%"><stop offset="0" stopColor="#C4B2FF" /><stop offset="1" stopColor="#6D3BF5" /></radialGradient></defs>
        <rect x="10" y="14" width="76" height="60" rx="10" fill="#F6EFE2" />
        <rect x="6" y="8" width="76" height="60" rx="12" fill={`url(#${u}G)`} />
        <rect x="18" y="22" width="40" height="7" rx="3.5" fill="#FFFFFF" opacity="0.9" />
        <rect x="18" y="34" width="28" height="6" rx="3" fill="#FFFFFF" opacity="0.6" />
      </svg>
    );
  }
  if (variant === "tile" || variant === "tileDot") {
    return (
      <svg width={width ?? 32} height={height ?? 30} viewBox="0 0 96 90" aria-hidden="true" className={className}>
        <defs><radialGradient id={`${u}G`} cx="30%" cy="22%" r="90%"><stop offset="0" stopColor="#C4B2FF" /><stop offset="1" stopColor="#5A2EE0" /></radialGradient></defs>
        <rect x="12" y="18" width="76" height="60" rx="11" fill="#FFFFFF" />
        <rect x="6" y="8" width="76" height="60" rx="13" fill={`url(#${u}G)`} />
        <rect x="18" y="22" width="40" height="8" rx="4" fill="#FFFFFF" opacity="0.8" />
        <rect x="18" y="36" width="26" height="7" rx="3.5" fill="#FFFFFF" opacity="0.55" />
        {variant === "tileDot" && <circle cx="66" cy="48" r="9" fill="#FFB547" />}
      </svg>
    );
  }
  return (
    <svg width={width ?? 66} height={height ?? 62} viewBox="0 0 96 90" aria-hidden="true" className={className}>
      <defs><radialGradient id={`${u}G`} cx="30%" cy="22%" r="90%"><stop offset="0" stopColor="#FFE3A8" /><stop offset="0.5" stopColor="#FFB547" /><stop offset="1" stopColor="#D9800F" /></radialGradient></defs>
      <rect x="12" y="18" width="76" height="60" rx="11" fill="#FFF6E5" />
      <rect x="12" y="66" width="76" height="6" rx="3" fill="#E9DCC2" />
      <rect x="6" y="8" width="76" height="60" rx="13" fill={`url(#${u}G)`} />
      <rect x="18" y="22" width="40" height="7" rx="3.5" fill="#FFFFFF" opacity="0.75" />
      <rect x="18" y="34" width="26" height="6" rx="3" fill="#FFFFFF" opacity="0.5" />
      <path d="M62 8 V30 L67 26 L72 30 V8 Z" fill="#FF6B9A" />
    </svg>
  );
}
