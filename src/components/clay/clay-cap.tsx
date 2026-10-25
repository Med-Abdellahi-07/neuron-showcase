import { useUid } from "./uid";
import type { ClayProps } from "./types";

/** قبعة التخرج. home = VHome (بيت الرأس)، login = Login.html */
export function ClayCap({ variant = "home", width, height, className }: ClayProps & { variant?: "home" | "login" }) {
  const u = useUid("cap");
  if (variant === "login") {
    return (
      <svg width={width ?? 92} height={height ?? 92} viewBox="0 0 92 92" aria-hidden="true" className={className}>
        <defs>
          <radialGradient id={`${u}G`} cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#9B7BFF" /><stop offset="1" stopColor="#4A22C4" /></radialGradient>
        </defs>
        <path d="M14 46 Q14 40 20 41 L46 50 L72 41 Q78 40 78 46 L78 58 Q46 74 14 58 Z" fill="#3A1A9E" />
        <path d="M6 34 L46 18 L86 34 L46 50 Z" fill={`url(#${u}G)`} />
        <path d="M46 34 L74 44 L74 62" fill="none" stroke="#FFB547" strokeWidth="3" strokeLinecap="round" />
        <circle cx="74" cy="66" r="5" fill="#FFB547" />
      </svg>
    );
  }
  return (
    <svg width={width ?? 80} height={height ?? 72} viewBox="0 0 92 82" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={`${u}Top`} cx="35%" cy="25%" r="85%"><stop offset="0" stopColor="#D9CCFF" /><stop offset="0.55" stopColor="#8B66FF" /><stop offset="1" stopColor="#4A22C4" /></radialGradient>
        <linearGradient id={`${u}Base`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5A2EE0" /><stop offset="1" stopColor="#2E1180" /></linearGradient>
        <radialGradient id={`${u}Tas`} cx="35%" cy="30%" r="70%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="1" stopColor="#E9971A" /></radialGradient>
      </defs>
      <path d="M16 40 Q16 34 22 35 L46 44 L70 35 Q76 34 76 40 L76 54 Q46 70 16 54 Z" fill={`url(#${u}Base)`} />
      <path d="M4 30 L46 13 L88 30 L46 47 Z" fill={`url(#${u}Top)`} />
      <path d="M14 30 L46 18 L60 23" fill="none" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <path d="M46 30 L74 40 L74 60" fill="none" stroke="#FFB547" strokeWidth="3" strokeLinecap="round" />
      <circle cx="74" cy="64" r="6" fill={`url(#${u}Tas)`} />
      <circle cx="46" cy="30" r="3.5" fill="#FFB547" />
    </svg>
  );
}
