import { PageSkeleton, Skeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <div className="space-y-2">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-10" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-[50vh]" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </PageSkeleton>
  );
}
