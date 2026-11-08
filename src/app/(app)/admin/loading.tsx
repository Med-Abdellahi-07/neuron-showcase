import { PageSkeleton, Skeleton } from "@/components/skeleton";

// The admin tab bar (from admin/layout) stays visible; this only fills the content area.
export default function Loading() {
  return (
    <PageSkeleton className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </PageSkeleton>
  );
}
