import { createClient } from "@/lib/supabase/server";
import { getT } from "@/lib/i18n/server";
import { INTL_TAG, type DictKey } from "@/lib/i18n/dictionaries";

interface Row {
  provider: string;
  status: number;
  reason: string | null;
  message: string | null;
  at: string;
}

/** تلخيص سبب 429: يومي أم بالدقيقة؟ (من نص رسالة Google/Groq) */
function quotaKind(r: Row): DictKey | null {
  if (r.status !== 429) return null;
  const m = `${r.reason ?? ""} ${r.message ?? ""}`.toLowerCase();
  if (/per ?day|daily|requestsperday|tokens per day|tpd|rpd/.test(m)) return "lasterr.daily";
  if (/per ?minute|perminute|rpm|tpm|tokens per minute/.test(m)) return "lasterr.minute";
  return "lasterr.generic";
}

/** آخر سبب فشل لكل مزوّد (محفوظ في قاعدة البيانات فيشمل كل نسخ الخادم) */
export async function AiLastErrors() {
  const { t, locale } = await getT();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_last_errors");
  const rows = (data ?? []) as Row[];
  return (
    <section className="card space-y-2 p-4">
      <h3 className="text-sm font-semibold">{t("lasterr.title")}</h3>
      {error ? (
        <p className="text-xs text-muted">{t("lasterr.readFail")} ({error.message})</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">{t("lasterr.none")}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.provider} className="rounded border border-border p-2 text-xs" dir="ltr">
              <p className="font-semibold">
                {r.provider} — HTTP {r.status}
                {r.reason ? ` — ${r.reason}` : ""} — {new Date(r.at).toLocaleString(INTL_TAG[locale])}
              </p>
              {quotaKind(r) && <p className="text-muted" dir="auto">{t(quotaKind(r) as DictKey)}</p>}
              <p className="break-words text-muted">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
