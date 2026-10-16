import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton className="space-y-4">
      <TitleSkeleton width="w-36" />
      <Skeleton className="h-24" />
    </PageSkeleton>
  );
}
