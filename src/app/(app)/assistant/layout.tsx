import { requireFeature } from "@/lib/spaces";
import { getAiBalance } from "@/lib/ai/access";
import { AiTabs, type AiTab } from "@/components/ai-tabs";

/** All assistant pages are gated on the server for spaces without the AI feature; each section has its own flag (ai_chat / ai_summary / ai_qcm). */
export default async function AssistantLayout({ children }: { children: React.ReactNode }) {
  await requireFeature("ai");
  const bal = await getAiBalance();
  const tabs: AiTab[] = [];
  if (bal?.flags.ai_chat) tabs.push({ href: "/assistant", key: "ai.tab.chat" });
  if (bal?.flags.ai_summary) tabs.push({ href: "/assistant/summaries", key: "ai.tab.summaries" });
  if (bal?.flags.ai_qcm) tabs.push({ href: "/assistant/qcm", key: "ai.tab.qcm" });
  return (
    <>
      {bal && tabs.length > 0 && <AiTabs tabs={tabs} pressured={bal.pressure < 1} />}
      {children}
    </>
  );
}
