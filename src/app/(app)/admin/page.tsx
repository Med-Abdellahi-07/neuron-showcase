import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { AdminInsights } from "@/components/admin-insights";

async function count(table: string, filter?: [string, string]) {
  const supabase = await createClient();
  let q = supabase.from(table).select("id", { count: "exact", head: true });
  if (filter) q = q.eq(filter[0], filter[1]);
  const { count: n } = await q;
  return n ?? 0;
}

export default async function AdminHome() {
  const profile = await requireStaff();
  const { t } = await getT();
  const isAdmin = profile.role === "admin";

  const [published, pendingLessons, pendingQuestions, questions, accounts] = await Promise.all([
    count("lessons", ["status", "published"]),
    count("lessons", ["status", "pending"]),
    count("questions", ["status", "pending"]),
    count("questions", ["status", "published"]),
    isAdmin ? count("profiles") : Promise.resolve(null),
  ]);

  const stats = [
    { label: t("admin.lessonsPublished"), value: published },
    { label: t("admin.questions"), value: questions },
    { label: t("admin.lessonsPending"), value: pendingLessons + pendingQuestions, href: isAdmin ? "/admin/approvals" : undefined },
    ...(accounts !== null ? [{ label: t("admin.accounts"), value: accounts, href: "/admin/accounts" }] : []),
  ];

  return (
    <div className="space-y-8">
    <ul className="grid grid-cols-2 gap-3">
      {stats.map((s) => {
        const body = (
          <>
            <p className="tech text-3xl font-semibold text-accent" dir="ltr">{s.value}</p>
            <p className="mt-1 text-xs text-muted">{s.label}</p>
          </>
        );
        return (
          <li key={s.label}>
            {s.href ? (
              <Link href={s.href} className="card block transition-colors hover:bg-surface-2">{body}</Link>
            ) : (
              <div className="card">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
    {isAdmin && <AdminInsights />}
    </div>
  );
}
