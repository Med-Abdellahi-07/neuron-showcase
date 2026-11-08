"use client";

import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { MathSpan } from "@/components/math-span";
import { normalizeMath } from "@/lib/math";

/** Renders Markdown with KaTeX formulas and code. Study content is French, so dir=auto. */
export function Rich({ children }: { children: string }) {
  return (
    <div className="rich text-sm leading-7" dir="auto">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]} components={{ span: MathSpan }}>
        {normalizeMath(children)}
      </ReactMarkdown>
    </div>
  );
}
