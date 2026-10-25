import { OfflineLibrary } from "@/components/offline-library";

export const metadata = { title: "Offline" };

/** صفحة المحفوظات: لا بيانات خاصة في HTML (كل شيء يُقرأ من الجهاز) فيصح تخزينها في كاش الـservice worker */
export default function OfflinePage() {
  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <OfflineLibrary />
    </main>
  );
}
