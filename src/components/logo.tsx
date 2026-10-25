export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="tech inline-flex items-center gap-2 text-lg font-semibold">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#6D3BF5" />
        <path d="M9 23V9l14 14V9" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="9" cy="9" r="2.4" fill="#FFB547" />
        <circle cx="23" cy="23" r="2.4" fill="#FFB547" />
      </svg>
      Neuron
    </span>
  );
}
