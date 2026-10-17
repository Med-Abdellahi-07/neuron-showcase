import { createClient } from "@/lib/supabase/server";

interface Row {
  provider: string;
  status: number;
  reason: string | null;
  message: string | null;
  at: string;
}

/** تلخيص سبب 429: يومي أم بالدقيقة؟ (من نص رسالة Google/Groq) */
function quotaKind(r: Row): string | null {
  if (r.status !== 429) return null;
  const m = `${r.reason ?? ""} ${r.message ?? ""}`.toLowerCase();
  if (/per ?day|daily|requestsperday|tokens per day|tpd|rpd/.test(m)) return "حدّ يومي مستنفد — ينتظر حتى تجدّد الحصة (منتصف الليل بتوقيت المحيط الهادئ لـ Gemini).";
  if (/per ?minute|perminute|rpm|tpm|tokens per minute/.test(m)) return "حدّ بالدقيقة — يزول خلال دقيقة تقريباً.";
  return "تجاوز للحصة؛ اقرأ الرسالة لمعرفة هل هو يومي أم بالدقيقة.";
}

/** آخر سبب فشل لكل مزوّد (محفوظ في قاعدة البيانات فيشمل كل نسخ الخادم) */
export async function AiLastErrors() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ai_last_errors");
  const rows = (data ?? []) as Row[];
  return (
    <section className="card space-y-2 p-4">
      <h3 className="text-sm font-semibold">آخر أسباب فشل المزوّدين (من استخدام الطلاب الفعلي)</h3>
      {error ? (
        <p className="text-xs text-muted">تعذّرت القراءة ({error.message}). شغّل الهجرة 0009 في Supabase.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted">لا إخفاقات مسجّلة بعد.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.provider} className="rounded border border-border p-2 text-xs" dir="ltr">
              <p className="font-semibold">
                {r.provider} — HTTP {r.status}
                {r.reason ? ` — ${r.reason}` : ""} — {new Date(r.at).toLocaleString("fr-FR")}
              </p>
              {quotaKind(r) && <p className="text-muted" dir="rtl">{quotaKind(r)}</p>}
              <p className="break-words text-muted">{r.message}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
