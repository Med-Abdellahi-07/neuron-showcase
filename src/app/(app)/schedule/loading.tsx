import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton className="space-y-6">
      <TitleSkeleton width="w-28" />
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-10" />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-10" />
      </div>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ))}
    </PageSkeleton>
  );
}
