import type { ReactNode } from "react";

/** كتلة رمادية نابضة تشغل مكان المحتوى حتى يصل. تحترم تفضيل تقليل الحركة. */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-[var(--radius)] bg-surface-2 motion-reduce:animate-none ${className}`}
    />
  );
}

/** غلاف يُعلِم قارئات الشاشة بأن المحتوى قيد التحميل. */
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
