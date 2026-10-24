import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAiFlag } from "@/lib/ai/access";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { Rich } from "@/components/rich";
import { Flashcards, type Card } from "@/components/flashcards";
import { ActionForm } from "@/components/action-form";
import { generateSummary } from "@/app/actions/ai-summary";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SummaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  await requireAiFlag("ai_summary");
  const userId = await requireUserId();
  const { t } = await getT();
  const supabase = await createClient();
  const { data } = await supabase.from("ai_summaries").select("id, title, kind, lang, content, cards, lesson_ids").eq("id", id).eq("user_id", userId).maybeSingle();
  if (!data) notFound();
  const cards = (data.cards as Card[] | null) ?? null;

  return (
    <div className="space-y-4">
      <Link href="/assistant/summaries" className="text-sm text-accent">← {t("sum.title")}</Link>
      <header>
        <h1 className="page-title !mb-1" dir="auto">{data.title}</h1>
        <p className="tech text-xs text-muted">{t(`sum.kind.${data.kind as "short"}`)} · {String(data.lang).toUpperCase()} · {t("sum.savedFree")}</p>
      </header>
      {data.kind === "flashcards" && cards?.length ? <Flashcards cards={cards} /> : <article className="card"><Rich>{data.content as string}</Rich></article>}
      <details className="card">
        <summary className="cursor-pointer text-sm font-medium">{t("sum.regenerate")}</summary>
        <p className="mb-3 mt-2 text-xs text-muted">{t("sum.regenerateHelp")}</p>
        <ActionForm action={generateSummary} submitLabel={t("sum.regenerate")} className="space-y-3">
          <input type="hidden" name="replace" value={data.id as string} />
          {(data.lesson_ids as string[]).map((l) => <input key={l} type="hidden" name="lesson" value={l} />)}
          <input type="hidden" name="kind" value={data.kind as string} />
          <input type="hidden" name="lang" value={data.lang as string} />
        </ActionForm>
      </details>
    </div>
  );
}
