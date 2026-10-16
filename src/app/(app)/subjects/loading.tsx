import { PageSkeleton, Skeleton, TitleSkeleton } from "@/components/skeleton";

export default function Loading() {
  return (
    <PageSkeleton className="space-y-4">
      <TitleSkeleton width="w-32" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-28" />
      ))}
    </PageSkeleton>
  );
}
