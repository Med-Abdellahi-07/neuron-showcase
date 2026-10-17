export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="tech inline-flex items-center gap-2 text-lg font-semibold">
      <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
        <rect width="512" height="512" rx="112" fill="var(--accent)" />
        <path d="M150 360V152l212 208V152" fill="none" stroke="var(--primary-fg)" strokeWidth="28" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="150" cy="152" r="24" fill="var(--primary-fg)" />
        <circle cx="362" cy="360" r="24" fill="var(--primary-fg)" />
      </svg>
      Neuron
    </span>
  );
}
