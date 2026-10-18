"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

/** Markdown + KaTeX + أكواد لصفحة الطباعة. المحتوى بالفرنسية فاتجاهه تلقائي. `inline`: للخيارات (بلا فقرة منفصلة). */
export function PrintMd({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <div className={`qcm-md ${inline ? "qcm-md-inline" : ""}`} dir="auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
