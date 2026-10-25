import { requireUserId } from "@/lib/auth";
import { requireFeature } from "@/lib/spaces";
import { SpaceChat } from "@/components/space-chat";

export const metadata = { title: "Chat" };

export default async function ChatPage() {
  await requireUserId();
  await requireFeature("chat");
  return <SpaceChat />;
}
