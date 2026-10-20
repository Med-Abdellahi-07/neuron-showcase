import { getSpace } from "@/lib/spaces";
import { PracticeTabsClient } from "@/components/practice-tabs-client";
import type { DictKey } from "@/lib/i18n/dictionaries";

/** تبويبات التمارين تتكيّف مع ميزات الفضاء: الأساسي يرى «تدرّب» فقط (QCM) */
export async function PracticeTabs() {
  const f = (await getSpace())?.features;
  const tabs: { href: string; key: DictKey }[] = [{ href: "/practice", key: "arena.tab.train" }];
  if (f?.duel) tabs.push({ href: "/practice/duel", key: "duel.tab" });
  if (f?.ranking) tabs.push({ href: "/practice/leaderboard", key: "arena.tab.ranking" });
  if (f?.review) tabs.push({ href: "/practice/mistakes", key: "arena.tab.mistakes" });
  if (tabs.length === 1) return null;
  return <PracticeTabsClient tabs={tabs} />;
}
