import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton>
      <TitleSkeleton width="w-28" />
      <Skeleton className="h-72" />
    </PageSkeleton>
  );
}
