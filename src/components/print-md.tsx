"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MathSpan } from "@/components/math-span";
import { normalizeMath } from "@/lib/math";

/** Markdown + KaTeX + code for the print page. Content is French, so direction is automatic. `inline`: for options (no separate paragraph). */
export function PrintMd({ children, inline = false }: { children: string; inline?: boolean }) {
  return (
    <div className={`qcm-md ${inline ? "qcm-md-inline" : ""}`} dir="auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ span: MathSpan }}>
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
