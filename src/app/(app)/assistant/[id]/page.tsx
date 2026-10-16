import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getSubjectById } from "@/lib/data";
import { ChatView, type ChatMessage, type ChatSource } from "@/components/chat-view";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  await requireUserId();
  const { t } = await getT();
  const supabase = await createClient();

  const [{ data: conv }, { data: msgs }] = await Promise.all([
    supabase.from("conversations").select("id, subject_id, lesson_id, mode, title").eq("id", id).maybeSingle(),
    supabase
      .from("messages")
      .select("id, role, content, sources, provider, had_image")
      .eq("conversation_id", id)
      .order("created_at")
      .limit(200),
  ]);
  if (!conv) notFound();

  const [subject, lessonRes] = await Promise.all([
    conv.subject_id ? getSubjectById(conv.subject_id as string) : null,
    conv.lesson_id ? supabase.from("lessons").select("kind, number, title").eq("id", conv.lesson_id).maybeSingle() : null,
  ]);
  const lessonLabel = lessonRes?.data
    ? `${String(lessonRes.data.kind).toUpperCase()} ${lessonRes.data.number} — ${lessonRes.data.title}`
    : "";
  const scopeLabel = lessonLabel || (subject ? `${subject.code}` : "");

  const initial: ChatMessage[] = (msgs ?? []).map((m) => ({
    id: m.id as string,
    role: m.role as "user" | "assistant",
    content: m.content as string,
    sources: (m.sources as ChatSource[] | null) ?? null,
    provider: m.provider as string | null,
    hadImage: !!m.had_image,
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title !mb-0 min-w-0 truncate" dir="auto">{(conv.title as string) || t("chat.untitled")}</h1>
        <Link href="/assistant" className="shrink-0 text-sm text-accent hover:underline">{t("common.back")}</Link>
      </div>
      <ChatView
        key={id}
        conversationId={id}
        initialMode={conv.mode as "explain" | "review" | "solve"}
        scopeLabel={scopeLabel}
        initialMessages={initial}
      />
    </div>
  );
}
