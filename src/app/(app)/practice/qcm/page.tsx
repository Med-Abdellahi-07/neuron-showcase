import Link from "next/link";
import { FileDown } from "lucide-react";
import { requireUserId } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentSubjects } from "@/lib/data";
import { QCM_COUNTS, parseQcmParams } from "@/lib/qcm";

/** خيارات تنزيل QCM. النموذج GET إلى صفحة الطباعة في تبويب جديد؛ لا جلب للأسئلة هنا. */
export default async function QcmDownloadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserId();
  const { t } = await getT();
  const p = parseQcmParams(await searchParams);
  const supabase = await createClient();
  const [subjects, lessonRes] = await Promise.all([
    getCurrentSubjects(),
    p.lesson ? supabase.from("lessons").select("title, number, kind").eq("id", p.lesson).maybeSingle() : null,
  ]);
  const lessonTitle = lessonRes?.data ? `${String(lessonRes.data.kind).toUpperCase()} ${lessonRes.data.number} — ${lessonRes.data.title}` : "";

  return (
    <div className="space-y-5">
      <h1 className="page-title !mb-0 flex items-center gap-2">
        <FileDown size={22} strokeWidth={1.9} aria-hidden /> {t("qcm.title")}
      </h1>
      <p className="text-sm text-muted">{t("qcm.desc")}</p>

      <form action="/print/qcm" method="get" target="_blank" className="card-lg space-y-4">
        {p.lesson && lessonTitle ? (
          <div className="rounded-[var(--radius)] bg-accent-soft p-3 text-sm" dir="auto">
            <input type="hidden" name="lesson" value={p.lesson} />
            {t("practice.lesson")}: {lessonTitle}
          </div>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="subject">{t("practice.subject")}</label>
              <select id="subject" name="subject" className="input" dir="auto" defaultValue="">
                <option value="">{t("common.all")}</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="from">{t("practice.from")}</label>
                <input id="from" name="from" type="number" min={1} className="input" dir="ltr" />
              </div>
              <div>
                <label className="label" htmlFor="to">{t("practice.to")}</label>
                <input id="to" name="to" type="number" min={1} className="input" dir="ltr" />
              </div>
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="difficulty">{t("practice.difficulty")}</label>
            <select id="difficulty" name="difficulty" className="input" defaultValue="">
              <option value="">{t("diff.mix")}</option>
              <option value="easy">{t("diff.easy")}</option>
              <option value="medium">{t("diff.medium")}</option>
              <option value="hard">{t("diff.hard")}</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="count">{t("qcm.count")}</label>
            <select id="count" name="count" className="input" defaultValue="20" dir="ltr">
              {QCM_COUNTS.map((n) => (
                <option key={n} value={n}>{n === QCM_COUNTS[QCM_COUNTS.length - 1] ? t("qcm.countAll") : n}</option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name="shuffle" value="1" defaultChecked className="size-5 accent-[var(--accent)]" />
          {t("qcm.shuffle")}
        </label>
        <label className="flex min-h-10 items-center gap-3 text-sm">
          <input type="checkbox" name="explain" value="1" className="size-5 accent-[var(--accent)]" />
          {t("qcm.explain")}
        </label>

        <button type="submit" className="btn btn-primary w-full">
          <FileDown size={18} strokeWidth={1.9} aria-hidden /> {t("qcm.generate")}
        </button>
        <p className="text-xs text-muted">{t("qcm.howto")} {t("qcm.limitNote")}</p>
      </form>

      <Link href={p.lesson ? `/lessons/${p.lesson}` : "/practice"} className="inline-block text-sm text-accent hover:underline">{t("common.back")}</Link>
    </div>
  );
}
