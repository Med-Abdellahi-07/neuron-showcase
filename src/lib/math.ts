/**
 * يحوّل صيغ الرياضيات التي يكتبها النموذج بأشكال مختلفة إلى $...$ و$$...$$
 * حتى يعرضها KaTeX دائمًا بدل نص خام مثل {}^* أو \frac{a}{b}.
 * الأكواد (``` و `...`) لا تُمَسّ.
 */
const TOKEN = String.raw`(?:\\[a-zA-Z]+(?:\{[^{}]*\})*|[\^_]\{[^{}]*\}|\{\}[\^_]\S?)`;
const BARE = new RegExp(String.raw`(?:[A-Za-z0-9=+\-*/<>()]*${TOKEN})+(?:[A-Za-z0-9=+\-*/<>()]*[A-Za-z0-9)])?`, "g");

function bare(text: string): string {
  return text.replace(BARE, (m) => `$${m}$`);
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
