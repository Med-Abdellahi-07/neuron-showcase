"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MathSpan } from "@/components/math-span";
import { normalizeMath } from "@/lib/math";

/** Markdown + KaTeX + أكواد لصفحة الطباعة. المحتوى بالفرنسية فاتجاهه تلقائي. `inline`: للخيارات (بلا فقرة منفصلة). */
export function PrintMd({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <div className={`qcm-md ${inline ? "qcm-md-inline" : ""}`} dir="auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ span: MathSpan }}>
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
