import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton className="space-y-6">
      <TitleSkeleton width="w-48" />
      <Skeleton className="h-24" />
      <Skeleton className="h-28" />
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </PageSkeleton>
  );
}
