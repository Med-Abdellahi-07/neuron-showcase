import type { WindowRow } from "./guided";
import { LANG_NAME, type SessionLang } from "@/lib/ai/lang";
import { windowLabel } from "./guided";

export type Verdict = "correct" | "partial" | "wrong";

/** سؤال طُرح فعلاً في جلسة المراجعة، مع مصدره الحقيقي ونتيجته */
export interface ReviewEntry {
  k: number;
  ord: number; // ترتيب المقطع المصدر في النطاق
  label: string; // مثال: CM 1 — Intro (p. 3)
  lessonId: string;
  page: number;
  q: string; // نص السؤال (مختصر)
  verdict: Verdict | null; // null = لم يُجب
}

export interface Markers {
  verdict?: Verdict;
  src?: number; // رقم C# المصرَّح به
}

const MARKER = /\[\[(V|SRC):\s*([A-Za-z0-9]+)\s*\]\]/g;

/** يلتقط علامات [[V:correct]] و[[SRC:C2]] من نص الرد (وتُحذف من العرض) */
export function parseMarkers(text: string): { clean: string; markers: Markers } {
  const markers: Markers = {};
  const clean = text
    .replace(MARKER, (_m, kind: string, val: string) => {
      if (kind === "V" && ["correct", "partial", "wrong"].includes(val.toLowerCase())) markers.verdict = val.toLowerCase() as Verdict;
      if (kind === "SRC") {
        const n = parseInt(val.replace(/^C/i, ""), 10);
        if (!Number.isNaN(n)) markers.src = n;
      }
      return "";
    })
    .replace(/[ \t]+$/gm, "")
    .trim();
  return { clean, markers };
}

/**
 * مرشّح بثّ: يمرّر النص ويحجز أي ذيل يبدأ بـ "[[" حتى يكتمل "]]" فلا تظهر العلامات للطالب.
 * flush() يُرجع ما بقي (إن لم تكتمل العلامة يُعاد كنص عادي).
 */
export class MarkerFilter {
  private held = "";
  push(chunk: string): string {
    let buf = this.held + chunk;
    this.held = "";
    let out = "";
    for (;;) {
      const open = buf.indexOf("[[");
      if (open < 0) {
        // ذيل قد يكون بداية "[[" (حرف "[" واحد)
        if (buf.endsWith("[")) {
          this.held = "[";
          out += buf.slice(0, -1);
        } else out += buf;
        return out;
      }
      out += buf.slice(0, open);
      const close = buf.indexOf("]]", open);
      if (close < 0) {
        this.held = buf.slice(open);
        return out;
      }
      const body = buf.slice(open, close + 2);
      if (!/^\[\[(V|SRC):/.test(body)) out += body; // ليست علامة منا
      buf = buf.slice(close + 2);
    }
  }
  flush(): string {
    const r = this.held;
    this.held = "";
    return r;
  }
}

/** نص السؤال الجديد: ما بعد آخر عنوان "Question N/5" */
export function extractQuestion(clean: string, n: number): string {
  const re = new RegExp(`(?:Question|السؤال)\\s*${n}\\s*/\\s*5`, "i");
  const m = re.exec(clean);
  const text = m ? clean.slice(m.index) : clean.slice(-400);
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export const entryFromRow = (k: number, row: WindowRow, q: string): ReviewEntry => ({
  k,
  ord: row.ord,
  label: windowLabel(row),
  lessonId: row.lesson_id,
  page: row.page,
  q,
  verdict: null,
});

/** ملاحظة نظام للملخص النهائي: حقائق محسومة من السجل، لا استنتاجات */
export function summaryNote(a: { lang: SessionLang; log: ReviewEntry[]; pending: boolean }): string {
  const lang = LANG_NAME[a.lang];
  const lines = a.log.map((e, i) => {
    const status = e.verdict === "correct" ? "CORRECT" : e.verdict === "partial" ? "PARTIAL" : e.verdict === "wrong" ? "WRONG" : "NOT ANSWERED";
    return `Q${e.k} | ${status} | source: ${e.label} → cite [C${i + 1}] | ${e.q}`;
  });
  return `GUIDED REVIEW — FINAL SUMMARY. Write in ${lang}. The list below is GROUND TRUTH about the questions that were ACTUALLY asked in this session; use nothing else.
${lines.length ? lines.join("\n") : "(no question was asked)"}

Write a concise, encouraging summary with these sections, only including non-empty ones:
- "✅ Maîtrisé" : the CORRECT questions (one short line each: the notion mastered).
- "🔁 À revoir" : the WRONG and PARTIAL questions: for each, restate in one or two lines the correct idea (from the excerpts) and give the page to revisit, citing exactly the given [C#] marker (never another marker, never a page not listed above).
- "⏸ Non répondu" : questions with status NOT ANSWERED.
- Optional "📚 Pas encore abordé" : at most 3 topics taken from the UNTESTED MATERIAL (if provided), each with its label in plain text (no [C#]).
Never place in Maîtrisé or À revoir a topic that was not asked above. Do not ask a new question. Finish with one motivating sentence and a suggestion of what to do next.${a.pending ? " The last question was left unanswered." : ""}
Do NOT output any [[...]] marker.`;
}
