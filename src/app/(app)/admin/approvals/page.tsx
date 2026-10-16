import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { setLessonStatus, setQuestionStatus } from "@/app/actions/content";

type L = { id: string; kind: string; number: number; title: string; subjects: { code: string } | { code: string }[] | null };
type Q = { id: string; statement: string; type: string; difficulty: string; subjects: { code: string } | { code: string }[] | null };
const code = (s: L["subjects"]) => (Array.isArray(s) ? s[0]?.code : s?.code) ?? "";

function Actions({ id, action }: { id: string; action: (fd: FormData) => Promise<void> }) {
  return (
    <div className="flex gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="published" />
        <ApproveBtn />
      </form>
      <form action={action}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="status" value="draft" />
        <RejectBtn />
      </form>
    </div>
  );
}
async function ApproveBtn() {
  const { t } = await getT();
  return <button className="btn btn-sm btn-primary">{t("action.approve")}</button>;
}
async function RejectBtn() {
  const { t } = await getT();
  return <button className="btn btn-sm">{t("action.reject")}</button>;
}

export default async function ApprovalsPage() {
  await requireAdmin();
  const { t } = await getT();
  const supabase = await createClient();
  const [{ data: lessons }, { data: questions }] = await Promise.all([
    supabase.from("lessons").select("id, kind, number, title, subjects(code)").eq("status", "pending").order("created_at"),
    supabase.from("questions").select("id, statement, type, difficulty, subjects(code)").eq("status", "pending").order("created_at").limit(100),
  ]);
  const ls = (lessons ?? []) as unknown as L[];
  const qs = (questions ?? []) as unknown as Q[];

  if (!ls.length && !qs.length) return <p className="text-sm text-muted">{t("approvals.none")}</p>;

  return (
    <div className="space-y-8">
      {ls.length > 0 && (
        <section className="space-y-2" aria-labelledby="al">
          <h2 id="al" className="tech text-sm font-semibold">{t("approvals.lessons")}</h2>
          <ul className="space-y-2">
            {ls.map((l) => (
              <li key={l.id} className="card space-y-2 !p-3">
                <Link href={`/admin/content/${l.id}`} className="block text-sm hover:underline" dir="auto">
                  <span className="tech text-accent" dir="ltr">{code(l.subjects)} {l.kind.toUpperCase()} {l.number}</span> · {l.title}
                </Link>
                <Actions id={l.id} action={setLessonStatus} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {qs.length > 0 && (
        <section className="space-y-2" aria-labelledby="aq">
          <h2 id="aq" className="tech text-sm font-semibold">{t("approvals.questions")}</h2>
          <ul className="space-y-2">
            {qs.map((q) => (
              <li key={q.id} className="card space-y-2 !p-3">
                <p className="line-clamp-2 text-sm" dir="auto">
                  <span className="tech text-accent" dir="ltr">{code(q.subjects)}</span> · {q.statement}
                </p>
                <Actions id={q.id} action={setQuestionStatus} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
