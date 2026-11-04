"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { fetchJoined } from "@/lib/big-file";

/** ملف مجزّأ في Storage يظهر للمستخدم «ملفاً واحداً»: عند الطلب تُجلب الأجزاء وتُضمّ في Blob (مع التحقق من البصمات). */
export function BigFileViewer({ name, urls, hashes, size, kind }: { name: string; urls: string[]; hashes: string[] | null; size: number; kind: "pdf" | "other" }) {
  const { t } = useT();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);
  const [err, setErr] = useState(false);
  const blobRef = useRef<Blob | null>(null);
  const acRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    acRef.current?.abort();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }, [blobUrl]);

  async function ensure(): Promise<string | null> {
    if (blobUrl) return blobUrl;
    setErr(false);
    const ac = new AbortController();
    acRef.current = ac;
    setProgress([0, urls.length]);
    try {
      const blob = await fetchJoined(urls, { hashes, type: kind === "pdf" ? "application/pdf" : "application/octet-stream", signal: ac.signal, onProgress: (d, n) => setProgress([d, n]) });
      blobRef.current = blob;
      const u = URL.createObjectURL(blob);
      setBlobUrl(u);
      return u;
    } catch {
      setErr(true);
      return null;
    } finally {
      setProgress(null);
    }
  }

  async function download() {
    const u = await ensure();
    if (!u) return;
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
  }

  const mb = (size / 1048576).toFixed(1);
  return (
    <div className="space-y-2" data-testid="big-file">
      {blobUrl && kind === "pdf" && <iframe src={blobUrl} title={name} className="h-[70vh] w-full rounded-[var(--radius)] border border-border bg-surface-2" />}
      <div className="card flex flex-wrap items-center justify-between gap-2 !p-3">
        <span className="tech min-w-0 truncate text-xs text-muted" dir="ltr">{name} · {mb} MB</span>
        <span className="flex gap-2">
          {kind === "pdf" && !blobUrl && (
            <button type="button" className="btn btn-sm" onClick={ensure} disabled={!!progress}>
              {progress ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ExternalLink size={14} aria-hidden />} {t("file.open")}
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={download} disabled={!!progress}>
            <Download size={14} aria-hidden /> {t("file.download")}
          </button>
        </span>
        {progress && <p className="tech w-full text-xs text-muted" role="status" dir="ltr">{t("file.joining")} {progress[0]}/{progress[1]}</p>}
        {err && <p role="alert" className="w-full text-xs text-danger">{t("file.joinErr")}</p>}
      </div>
    </div>
  );
}
