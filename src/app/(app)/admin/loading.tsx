import { PageSkeleton, Skeleton } from "@/components/skeleton";

// شريط تبويبات المشرف يبقى ظاهراً (من admin/layout)، وهذا يشغل مكان المحتوى فقط
export default function Loading() {
  return (
    <PageSkeleton className="grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-24" />
      ))}
    </PageSkeleton>
  );
}
