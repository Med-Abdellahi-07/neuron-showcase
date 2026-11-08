import { OfflineApp } from "@/components/offline-app";

export const metadata = { title: { absolute: "Neuron" } };

/**
 * Local app: no private data in the HTML (everything is read from IndexedDB), so it is safe to keep in the service worker cache
 * and serve when the app starts offline (start_url).
 */
export default function OfflinePage() {
  return <OfflineApp />;
}
