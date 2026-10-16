import Link from "next/link";
import { Activity, MessageSquare, Trash2 } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { formatDate } from "@/lib/dates";
import { SubmitButton } from "@/components/submit-button";
import { deleteConversation, startChat } from "@/app/actions/assistant";

interface Conv {
  id: string;
  title: string;
  mode: string;
  updated_at: string;
  subjects: { code: string } | { code: string }[] | null;
}
const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

export default async function AssistantPage() {
  const userId = await requireUserId();
  const { t, locale } = await getT();
  const supabase = await createClient();
  const [subjects, convRes] = await Promise.all([
    getCurrentSubjects(),
    supabase
      .from("conversations")
      .select("id, title, mode, updated_at, subjects(code)")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50),
  ]);
  const convs = (convRes.data ?? []) as unknown as Conv[];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="page-title !mb-0">{t("assistant.title")}</h1>
        <Link href="/assistant/analysis" className="btn btn-sm">
          <Activity size={14} aria-hidden /> {t("chat.analysisLink")}
        </Link>
      </div>

      <form action={startChat} className="card space-y-3">
        <h2 className="tech text-sm font-semibold">{t("chat.new")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="c-subject">{t("chat.subject")}</label>
            <select id="c-subject" name="subject" className="input" dir="auto">
              <option value="">{t("common.all")}</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="c-mode">{t("chat.mode")}</label>
            <select id="c-mode" name="mode" className="input" defaultValue="explain">
              <option value="explain">{t("chat.mode.explain")}</option>
              <option value="review">{t("chat.mode.review")}</option>
              <option value="solve">{t("chat.mode.solve")}</option>
            </select>
          </div>
        </div>
        <SubmitButton className="btn btn-primary w-full">{t("chat.start")}</SubmitButton>
      </form>

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
