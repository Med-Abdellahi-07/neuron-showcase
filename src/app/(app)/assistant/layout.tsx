import { requireFeature } from "@/lib/spaces";

/** كل صفحات المساعد والتحليل مقفولة على الخادم في الفضاءات بلا ميزة الذكاء الاصطناعي */
export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  await requireFeature("ai");
  return children;
}
