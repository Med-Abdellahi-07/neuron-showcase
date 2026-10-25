/**
 * يحوّل صيغ الرياضيات التي يكتبها النموذج بأشكال مختلفة إلى $...$ و$$...$$
 * حتى يعرضها KaTeX دائمًا بدل نص خام مثل {}^* أو \frac{a}{b}.
 * الأكواد (``` و `...`) لا تُمَسّ.
 */
// وحدات الصيغة: أمر LaTeX (مع وسيط حرف مفرد اختياري مثل \hat y)، أس/دليل، أو حرف رياضي ملاصق
const ATOM = String.raw`\\[a-zA-Z]+(?:\{[^{}]*\})*(?: ?[A-Za-z0-9])?|[\^_](?:\{[^{}]*\}|[A-Za-z0-9])|\{\}(?:[\^_](?:\{[^{}]*\}|[A-Za-z0-9*+\-']))?|[A-Za-z0-9()+\-*/=<>|]`;
const RUN = new RegExp(`(?:${ATOM})+`, "g");
// لا نلفّ إلا إن وُجد أمر LaTeX أو أس/دليل بأقواس، حتى لا تتحول snake_case العادية إلى معادلات
const STRONG = /\\[a-zA-Z]|[\^_]\{|\{\}/;

function bare(text: string): string {
  return text.replace(RUN, (m) => (STRONG.test(m) ? `$${m}$` : m));
}

function plain(text: string): string {
  let s = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$${m.trim()}$$\n`);
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
  // أجزاء الرياضيات الموجودة أصلًا لا تُلفّ مرتين
  const parts = s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((p, i) => (i % 2 ? p : bare(p))).join("");
}

export function normalizeMath(src: string): string {
  if (!src) return src;
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts.map((p, i) => (i % 2 ? p : plain(p))).join("");
}
