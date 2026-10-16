import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton className="space-y-6">
      <div className="space-y-2">
        <TitleSkeleton width="w-52" />
        <Skeleton className="h-5 w-36" />
      </div>
      <Skeleton className="h-20" />
      <Skeleton className="h-24" />
      <Skeleton className="h-40" />
    </PageSkeleton>
  );
}
