import { useUid } from "./uid";
import type { ClayProps } from "./types";

/** كرة المساعد: نجمة تتلألأ وقمر ذهبي يدور (aorb / atw في globals.css) */
export function AiOrb({ width = 78, height = 78, label = "Neuron AI", className }: ClayProps & { label?: string }) {
  const u = useUid("orb");
  return (
    <svg width={width} height={height} viewBox="0 0 90 90" role="img" aria-label={label} className={className}>
      <defs>
        <radialGradient id={`${u}G`} cx="34%" cy="28%" r="80%"><stop offset="0" stopColor="#F1ECFF" /><stop offset="0.45" stopColor="#9B7BFF" /><stop offset="1" stopColor="#4A22C4" /></radialGradient>
        <radialGradient id={`${u}S`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="1" stopColor="#E9971A" /></radialGradient>
      </defs>
      <ellipse cx="45" cy="45" rx="42" ry="14" fill="none" stroke="#7C5CE6" strokeWidth="2" opacity="0.7" transform="rotate(-20 45 45)" />
      <circle cx="45" cy="45" r="27" fill={`url(#${u}G)`} />
      <path d="M28 36 Q32 25 44 23" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
      <path className="atw" d="M45 31 l3.4 9.6 9.6 3.4 -9.6 3.4 -3.4 9.6 -3.4-9.6 -9.6-3.4 9.6-3.4z" fill="#FFFFFF" />
      <g className="aorb"><circle cx="85" cy="40" r="5" fill={`url(#${u}S)`} /></g>
    </svg>
  );
}
