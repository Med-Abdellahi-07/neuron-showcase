"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Check, Copy, ImagePlus, Send, Square, X } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { DictKey } from "@/lib/i18n/dictionaries";
import "katex/dist/katex.min.css";

export interface ChatSource {
  id: string;
  kind: "course" | "web";
  label: string;
  lessonId?: string;
  page?: number;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: ChatSource[] | null;
  provider?: string | null;
  hadImage?: boolean;
  outOfCurriculum?: boolean;
  fellBack?: boolean;
  error?: string;
}

type Mode = "explain" | "review" | "solve";
const MODES: Mode[] = ["explain", "review", "solve"];

/** يحوّل [C1] و[W2] إلى روابط داخلية تُعرض كشارات */
/** يدعم [C1] و[C1, C2] و[C1][W2] و[C1; C2]: كل مرجع زر مستقل */
const withCitations = (text: string) =>
  text.replace(/\[((?:[CW]\d{1,2})(?:\s*[,;،]\s*[CW]\d{1,2})*)\]/g, (_m, list: string) =>
    list
      .split(/\s*[,;،]\s*/)
      .map((id) => `[${id}](#cite-${id})`)
      .join(" ")
  );

/** المراجع المذكورة فعلاً في النص */
function citedIds(text: string): Set<string> {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\[((?:[CW]\d{1,2})(?:\s*[,;،]\s*[CW]\d{1,2})*)\]/g)) for (const id of m[1].split(/\s*[,;،]\s*/)) ids.add(id);
  return ids;
}

const usedSources = (m: ChatMessage) => {
  const cited = citedIds(m.content);
  return (m.sources ?? []).filter((s) => cited.has(s.id));
};

/** نص نظيف للنسخ: بلا علامات المراجع، والمعادلات تبقى LaTeX كما كتبها النموذج */
const cleanForCopy = (text: string) =>
  text
    .replace(/\s*\[(?:[CW]\d{1,2})(?:\s*[,;،]\s*[CW]\d{1,2})*\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  async function copy() {
    const value = cleanForCopy(text);
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" onClick={copy} className="btn btn-sm !px-2" aria-label={t("chat.copy")} title={t("chat.copy")}>
      {done ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      <span className="text-xs">{done ? t("chat.copied") : t("chat.copy")}</span>
    </button>
  );
}

/** رابط المرجع: الحصة مع الصفحة، والحصة تفتح الـPDF على تلك الصفحة */
const courseHref = (s: ChatSource) => `/lessons/${s.lessonId}${s.page ? `?page=${s.page}` : ""}#pdf-h`;

function Markdown({ text, sources }: { text: string; sources: ChatSource[] }) {
  const { t } = useT();
  const byId = new Map(sources.map((s) => [s.id, s]));
  return (
    <div className="rich text-sm leading-7" dir="auto">
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          a({ href, children }) {
            if (href?.startsWith("#cite-")) {
              const src = byId.get(href.slice(6));
              const badge = "tech mx-0.5 inline-flex items-center rounded bg-accent-soft px-1 text-[11px] font-semibold text-accent no-underline";
              if (!src) return <span className={badge}>{children}</span>;
              if (src.kind === "course" && src.lessonId)
                return (
                  <Link href={courseHref(src)} className={badge} title={src.label} aria-label={src.label}>
                    {children}
                  </Link>
                );
              return (
                <a href={src.url} target="_blank" rel="noopener noreferrer" className={badge} title={`${t("chat.fromWeb")}: ${src.label}`}>
                  {children}
                </a>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                {children}
              </a>
            );
          },
        }}
      >
        {withCitations(text)}
      </ReactMarkdown>
    </div>
  );
}

/** يصغّر الصورة في المتصفح قبل الإرسال (توفير للحصة ولحجم الطلب) */
async function toJpeg(file: File): Promise<{ mime: string; data: string; preview: string }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.82);
  return { mime: "image/jpeg", data: url.split(",")[1], preview: url };
}

export function ChatView({
  conversationId,
  initialMode,
  scopeLabel,
  initialMessages,
}: {
  conversationId: string;
  initialMode: Mode;
  scopeLabel: string;
  initialMessages: ChatMessage[];
}) {
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [text, setText] = useState("");
  const [deepen, setDeepen] = useState(false);
  const [images, setImages] = useState<{ mime: string; data: string; preview: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).slice(0, 2 - images.length);
    e.target.value = "";
    const next: { mime: string; data: string; preview: string }[] = [];
    for (const f of files) {
      try {
        next.push(await toJpeg(f));
      } catch {
        /* صورة غير مدعومة */
      }
    }
    setImages((cur) => [...cur, ...next].slice(0, 2));
  }

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    const sentImages = images;
    const uid = crypto.randomUUID();
    const aid = crypto.randomUUID();
    setMessages((m) => [
      ...m,
      { id: uid, role: "user", content: q, hadImage: sentImages.length > 0 },
      { id: aid, role: "assistant", content: "" },
    ]);
    setText("");
    setImages([]);
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    const patch = (p: Partial<ChatMessage> | ((x: ChatMessage) => Partial<ChatMessage>)) =>
      setMessages((all) => all.map((x) => (x.id === aid ? { ...x, ...(typeof p === "function" ? p(x) : p) } : x)));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          conversationId,
          text: q,
          mode,
          deepen,
          images: sentImages.map(({ mime, data }) => ({ mime, data })),
        }),
      });
      if (!res.ok || !res.body) {
        patch({ error: res.status === 429 ? "busy" : "unavailable" });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const ev = JSON.parse(line) as
            | { type: "sources"; sources: ChatSource[]; outOfCurriculum: boolean }
            | { type: "meta"; provider: string; fellBack: boolean }
            | { type: "delta"; text: string }
            | { type: "done" }
            | { type: "error"; code: string };
          if (ev.type === "sources") patch({ sources: ev.sources, outOfCurriculum: ev.outOfCurriculum });
          else if (ev.type === "meta") patch({ provider: ev.provider, fellBack: ev.fellBack });
          else if (ev.type === "delta") patch((x) => ({ content: x.content + ev.text }));
          else if (ev.type === "error") patch({ error: ev.code });
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") patch({ error: "unavailable" });
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  const errText = (code?: string) => (code === "busy" ? t("chat.busy") : code ? t("chat.unavailable") : "");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5" role="group" aria-label={t("chat.mode")}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-medium ${
                mode === m ? "border-transparent bg-accent text-accent-fg" : "border-border text-muted hover:text-fg"
              }`}
            >
              {t(`chat.mode.${m}` as DictKey)}
            </button>
          ))}
        </div>
        {scopeLabel && <span className="badge max-w-full truncate" dir="auto">{scopeLabel}</span>}
      </div>

      <ul className="space-y-4" aria-live="polite">
        {messages.length === 0 && <li className="card text-sm text-muted">{t("chat.welcome")}</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            {m.role === "user" ? (
              <div className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius)] bg-accent-soft p-3 text-sm" dir="auto">
                {m.hadImage && <span className="me-1" aria-label="image">📷</span>}
                {m.content}
              </div>
            ) : (
              <div className="card space-y-2">
                {m.outOfCurriculum && <span className="badge !text-warn">{t("chat.outOfCurriculum")}</span>}
                {m.content ? (
                  <Markdown text={m.content} sources={m.sources ?? []} />
                ) : (
                  !m.error && <span className="text-sm text-muted" aria-busy="true">…</span>
                )}
                {m.error && <p role="alert" className="text-sm text-danger">{errText(m.error)}</p>}
                {m.content && !m.error && <div className="flex justify-end"><CopyButton text={m.content} /></div>}
                {usedSources(m).length > 0 && (
                  <div className="space-y-1 border-t border-border pt-2">
                    <p className="label !mb-0">{t("chat.sources")}</p>
                    <ul className="space-y-1 text-xs">
                      {usedSources(m).map((s) => (
                        <li key={s.id} className="flex items-start gap-1.5" dir="auto">
                          <span className="tech rounded bg-accent-soft px-1 text-[11px] font-semibold text-accent">{s.id}</span>
                          <span className="badge shrink-0">{s.kind === "course" ? t("chat.fromCourse") : t("chat.fromWeb")}</span>
                          {s.kind === "course" && s.lessonId ? (
                            <Link href={courseHref(s)} className="min-w-0 text-accent hover:underline">{s.label}</Link>
                          ) : (
                            <a href={s.url} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-accent hover:underline">{s.label}</a>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.fellBack && <p className="text-[11px] text-muted">{t("chat.fallbackNote")}</p>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div ref={endRef} />

      <div className="sticky bottom-[4.5rem] space-y-2 rounded-[var(--radius)] border border-border bg-bg/95 p-3 backdrop-blur md:bottom-4">
        {images.length > 0 && (
          <ul className="flex gap-2">
            {images.map((im, i) => (
              <li key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.preview} alt="" className="size-14 rounded object-cover" />
                <button
                  type="button"
                  aria-label={t("chat.removeImage")}
                  onClick={() => setImages((cur) => cur.filter((_, k) => k !== i))}
                  className="absolute -end-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-fg text-bg"
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          className="input min-h-12"
          dir="auto"
          rows={2}
          maxLength={4000}
          value={text}
          placeholder={t("chat.placeholder")}
          aria-label={t("chat.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send();
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={onFiles} />
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={images.length >= 2} aria-label={t("chat.attach")}>
              <ImagePlus size={16} aria-hidden />
            </button>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={deepen} onChange={(e) => setDeepen(e.target.checked)} />
              {t("chat.deepen")}
            </label>
          </div>
          {busy ? (
            <button type="button" className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
              <Square size={14} aria-hidden /> {t("chat.stop")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={send} disabled={!text.trim()}>
              <Send size={14} aria-hidden /> {t("chat.send")}
            </button>
          )}
        </div>
        <p className="text-[11px] leading-5 text-muted">{t("chat.privacy")} {t("chat.imageNote")}</p>
      </div>
    </div>
  );
}
