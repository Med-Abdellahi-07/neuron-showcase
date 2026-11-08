/**
 * Converts math written by the model in various forms into $...$ and $$...$$
 * so KaTeX always renders it instead of raw text like {}^* or \frac{a}{b}.
 * Code (``` and `...`) is left untouched.
 */
// Formula units: a LaTeX command (with an optional single-character argument such as \hat y), a superscript/subscript, or an adjacent math letter.
const ATOM = String.raw`\\[a-zA-Z]+(?:\{[^{}]*\})*(?: ?[A-Za-z0-9])?|[\^_](?:\{[^{}]*\}|[A-Za-z0-9])|\{\}(?:[\^_](?:\{[^{}]*\}|[A-Za-z0-9*+\-']))?|[A-Za-z0-9()+\-*/=<>|]`;
const RUN = new RegExp(`(?:${ATOM})+`, "g");
// Only wrap when there is a LaTeX command or a braced superscript/subscript, so plain snake_case does not become a formula.
const STRONG = /\\[a-zA-Z]|[\^_]\{|\{\}/;

function bare(text: string): string {
  return text.replace(RUN, (m) => (STRONG.test(m) ? `$${m}$` : m));
}

function plain(text: string): string {
  let s = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$${m.trim()}$$\n`);
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m.trim()}$`);
  // Existing math segments are not wrapped twice.
  const parts = s.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  return parts.map((p, i) => (i % 2 ? p : bare(p))).join("");
}

export function normalizeMath(src: string): string {
  if (!src) return src;
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts.map((p, i) => (i % 2 ? p : plain(p))).join("");
}
