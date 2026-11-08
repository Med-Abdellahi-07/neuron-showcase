/** Lightweight SVG progress ring (no libraries): shows "done/total" in the center. */
export function ProgressRing({
  done,
  total,
  size = 64,
  stroke = 7,
  label,
}: {
  done: number;
  total: number;
  size?: number;
  stroke?: number;
  /** Alt text for screen readers. */
  label?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, done / total) : 0;
  return (
    <span
      role="img"
      aria-label={label ?? `${done}/${total}`}
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 rtl:rotate-90 rtl:-scale-x-100" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          style={{ transition: "stroke-dashoffset 400ms ease" }}
        />
      </svg>
      <span
        dir="ltr"
        className="tech absolute inset-0 flex items-center justify-center font-semibold"
        style={{ fontSize: Math.max(10, Math.round(size * 0.2)) }}
      >
        {done}/{total}
      </span>
    </span>
  );
}
