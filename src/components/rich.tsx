"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** يعرض Markdown مع معادلات KaTeX وأكواد. المحتوى الدراسي بالفرنسية، لذا dir=auto. */
export function Rich({ children }: { children: string }) {
  return (
    <div className="rich text-sm leading-7" dir="auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
