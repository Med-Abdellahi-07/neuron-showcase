import { useUid } from "./uid";

export type MedalKind = "streak" | "duel" | "goals" | "locked";

/** وسام: streak (ذهبي برقم)، duel (وردي ببرق)، goals (أخضر بعلامة)، locked (مقفل) */
export function Medal({ kind, value, label, className, style }: { kind: MedalKind; value?: number | string; label: string; className?: string; style?: React.CSSProperties }) {
  const u = useUid("med");
  return (
    <svg className={className} style={style} width="58" height="74" viewBox="0 0 58 74" role="img" aria-label={label}>
      <defs>
        <radialGradient id={`${u}Gold`} cx="34%" cy="26%" r="85%"><stop offset="0" stopColor="#FFF0B8" /><stop offset="0.5" stopColor="#FFC24A" /><stop offset="1" stopColor="#C97A0C" /></radialGradient>
        <radialGradient id={`${u}Pink`} cx="34%" cy="26%" r="85%"><stop offset="0" stopColor="#FFD0DF" /><stop offset="0.5" stopColor="#FF6B9A" /><stop offset="1" stopColor="#B8305E" /></radialGradient>
        <radialGradient id={`${u}Green`} cx="34%" cy="26%" r="85%"><stop offset="0" stopColor="#C8FAE4" /><stop offset="0.5" stopColor="#3CCB92" /><stop offset="1" stopColor="#0E7A52" /></radialGradient>
        <radialGradient id={`${u}Lock`} cx="34%" cy="26%" r="85%"><stop offset="0" stopColor="#6C4FD0" /><stop offset="1" stopColor="#2E1180" /></radialGradient>
      </defs>
      {kind === "streak" && (<>
        <path d="M16 0 H28 L22 26 H10 Z" fill="#6D3BF5" /><path d="M30 0 H42 L48 26 H36 Z" fill="#FF6B9A" />
        <circle cx="29" cy="46" r="24" fill="#B87008" />
        <circle cx="29" cy="44" r="24" fill={`url(#${u}Gold)`} />
        <circle cx="29" cy="44" r="17" fill="none" stroke="#FFF0B8" strokeWidth="1.5" opacity="0.7" />
        <path d="M14 36 Q18 26 28 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
        <text x="29" y="50" fontFamily="Readex Pro, sans-serif" fontSize="16" fontWeight="700" fill="#5A3200" textAnchor="middle">{value}</text>
      </>)}
      {kind === "duel" && (<>
        <path d="M16 0 H28 L22 26 H10 Z" fill="#FFB547" /><path d="M30 0 H42 L48 26 H36 Z" fill="#6D3BF5" />
        <circle cx="29" cy="46" r="24" fill="#94264C" />
        <circle cx="29" cy="44" r="24" fill={`url(#${u}Pink)`} />
        <path d="M14 36 Q18 26 28 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
        <path d="M31 31 L22 45 H29 L27 57 L37 41 H30 Z" fill="#FFFFFF" />
      </>)}
      {kind === "goals" && (<>
        <path d="M16 0 H28 L22 26 H10 Z" fill="#FF6B9A" /><path d="M30 0 H42 L48 26 H36 Z" fill="#FFB547" />
        <circle cx="29" cy="46" r="24" fill="#0A5E3F" />
        <circle cx="29" cy="44" r="24" fill={`url(#${u}Green)`} />
        <path d="M14 36 Q18 26 28 24" fill="none" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.6" />
        <path d="M19 45l7 7 13-14" fill="none" stroke="#FFFFFF" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </>)}
      {kind === "locked" && (<>
        <path d="M16 0 H28 L22 26 H10 Z" fill="#3A1A9E" /><path d="M30 0 H42 L48 26 H36 Z" fill="#3A1A9E" />
        <circle cx="29" cy="44" r="24" fill={`url(#${u}Lock)`} stroke="#7C5CE6" strokeWidth="2" strokeDasharray="4 4" />
        <rect x="20" y="42" width="18" height="14" rx="4" fill="#9F8BE0" />
        <path d="M23 42 V37 a6 6 0 0 1 12 0 V42" fill="none" stroke="#9F8BE0" strokeWidth="3" />
      </>)}
    </svg>
  );
}
