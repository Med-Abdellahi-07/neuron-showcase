import type { ComponentPropsWithoutRef } from "react";

/**
 * كل معادلة KaTeX تُعزل في span اتجاهه LTR (dir="ltr" + unicode-bidi: isolate)
 * حتى لا تُبعثر خوارزمية الاتجاه الثنائي رموزها (= + − ^ …) داخل نص عربي RTL.
 * تُمرَّر إلى ReactMarkdown كـ components.span.
 */
export function MathSpan({ node: _node, className, style, ...rest }: ComponentPropsWithoutRef<"span"> & { node?: unknown }) {
  const cls = Array.isArray(className) ? className.join(" ") : (className ?? "");
  const isMath = /(^|\s)(katex|katex-display)(\s|$)/.test(cls);
  return <span {...rest} className={className} style={isMath ? { ...style, unicodeBidi: "isolate" } : style} dir={isMath ? "ltr" : rest.dir} />;
}
