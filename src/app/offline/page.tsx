import { OfflineApp } from "@/components/offline-app";

export const metadata = { title: { absolute: "Neuron" } };

/**
 * التطبيق المحلي: لا بيانات خاصة في HTML (كل شيء يُقرأ من IndexedDB)، فيصح تخزينه في كاش الـservice worker
 * ويُقدَّم عند تشغيل التطبيق بلا إنترنت (start_url).
 */
export default function OfflinePage() {
  return <OfflineApp />;
}
