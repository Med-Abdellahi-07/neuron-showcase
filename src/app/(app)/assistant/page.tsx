import Link from "next/link";
import { Activity, MessageSquare, Trash2 } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { requireAiFlag } from "@/lib/ai/access";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { ChatPicker, type PickLesson } from "@/components/chat-picker";
import { deleteConversation } from "@/app/actions/assistant";

interface Conv {
  id: string;
  title: string;
  mode: string;
  updated_at: string;
  subjects: { code: string } | { code: string }[] | null;
}
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ lesson?: string }> }) {
  const sp = await searchParams;
  await requireAiFlag("ai_chat");
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [subjects, convRes, lessonRes] = await Promise.all([
    getCurrentSubjects(),
    supabase
      .from("conversations")
      .select("id, title, mode, updated_at, subjects(code)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50),
    supabase.from("lessons").select("id, subject_id, kind, number, title").eq("status", "published").order("number").limit(600),
  ]);
  const codeById = new Map(subjects.map((x) => [x.id, x.code]));
  const lessons: PickLesson[] = (lessonRes.data ?? [])
    .filter((l) => codeById.has(l.subject_id as string))
    .map((l) => ({ id: l.id as string, subject: codeById.get(l.subject_id as string)!, kind: l.kind as string, number: l.number as number, title: l.title as string }));
  const convs = (convRes.data ?? []) as unknown as Conv[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title !mb-0">{t("assistant.title")}</h1>
        <Link href="/assistant/analysis" className="btn btn-sm">
          <Activity size={14} aria-hidden /> {t("chat.analysisLink")}
        </Link>
      </div>

      <ChatPicker subjects={subjects.map((x) => ({ code: x.code, name: x.name }))} lessons={lessons} initialLessonId={sp.lesson} />

      <section className="space-y-2" aria-labelledby="hist-h">
        <h2 id="hist-h" className="tech text-sm font-semibold text-muted">{t("chat.history")}</h2>
        {convs.length === 0 ? (
          <p className="text-sm text-muted">{t("chat.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {convs.map((c) => {
              const code = first(c.subjects)?.code;
              return (
                <li key={c.id} className="card flex items-center justify-between gap-2 !p-3">
                  <Link href={`/assistant/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <MessageSquare size={18} className="shrink-0 text-accent" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium" dir="auto">{c.title || t("chat.untitled")}</span>
                      <span className="tech text-xs text-muted" dir="ltr">
                        {code ? `${code} · ` : ""}{formatDate(c.updated_at.slice(0, 10), locale)}
                      </span>
                    </span>
                  </Link>
                  <form action={deleteConversation}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="btn btn-sm !px-2 btn-danger" aria-label={t("chat.delete")}>
                      <Trash2 size={14} aria-hidden />
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
