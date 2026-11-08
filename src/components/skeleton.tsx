import type { ReactNode } from "react";

/** Pulsing gray block that fills the content's place until it arrives. Respects the reduced-motion preference. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--r-md)] bg-surface motion-reduce:animate-none ${className}`}
    />
  );
}

/** Wrapper that tells screen readers the content is loading. */
export function PageSkeleton({ children, className = "space-y-5" }: { children: ReactNode; className?: string }) {
  return (
    <div aria-busy="true" aria-live="polite" className={className}>
      {children}
    </div>
  );
}

export function TitleSkeleton({ width = "w-40" }: { width?: string }) {
  return <Skeleton className={`h-7 ${width}`} />;
}
