import type { ComponentPropsWithoutRef } from "react";

/**
 * Every KaTeX formula is isolated in a span with LTR direction (dir="ltr" + unicode-bidi: isolate)
 * so the bidi algorithm does not scatter its symbols (= + - ^ ...) inside Arabic RTL text.
 * Passed to ReactMarkdown as components.span.
 */
export function MathSpan({ node: _node, className, style, ...rest }: ComponentPropsWithoutRef<"span"> & { node?: unknown }) {
  const cls = Array.isArray(className) ? className.join(" ") : (className ?? "");
  const isMath = /(^|\s)(katex|katex-display)(\s|$)/.test(cls);
  return <span {...rest} className={className} style={isMath ? { ...style, unicodeBidi: "isolate" } : style} dir={isMath ? "ltr" : rest.dir} />;
}
