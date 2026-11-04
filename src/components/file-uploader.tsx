"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { registerFile } from "@/app/actions/content";
import { useT } from "@/lib/i18n/client";
import { Cancelled, PART_SIZE, manifestHash, partCountFor, partPath, sha256Hex, withRetry, xhrUpload } from "@/lib/big-file";
import { indexPdfInBrowser } from "@/lib/pdf-index-client";

const BUCKET = "lesson-files";

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}

const resumeKey = (lessonId: string, f: File) => `neuron-up:${lessonId}:${f.name}:${f.size}:${f.lastModified}`;
const lsGet = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* اختياري */ } };
const mb = (b: number) => (b / 1048576).toFixed(1);

type Phase = "idle" | "uploading" | "saving" | "indexing" | "cancelled";

export function FileUploader({ lessonId }: { lessonId: string }) {
  const { t } = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [kind, setKind] = useState<"pdf" | "code" | "data">("pdf");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [part, setPart] = useState<[number, number]>([0, 0]);
  const [idx, setIdx] = useState<[number, number]>([0, 0]);
  const busy = phase === "uploading" || phase === "saving" || phase === "indexing";

  async function upload(file: File, signal: AbortSignal) {
    const supabase = createClient();
    const n = partCountFor(file.size);
    const multi = file.size > PART_SIZE;
    const key = resumeKey(lessonId, file);
    // الاستئناف: نفس الملف (الاسم+الحجم+التعديل) يعيد استخدام معرّفه وأجزاءه المرفوعة
    const fileId = (multi && lsGet(key)) || crypto.randomUUID();
    if (multi) lsSet(key, fileId);
    const path = multi ? `${lessonId}/${fileId}` : `${lessonId}/${Date.now()}-${safeName(file.name)}`;

    const existing = new Map<string, number>();
    if (multi) {
      const { data } = await supabase.storage.from(BUCKET).list(path, { limit: 2100 });
      for (const o of data ?? []) existing.set(o.name, Number((o.metadata as { size?: number } | null)?.size ?? 0));
    }

    const { data: sess } = await supabase.auth.getSession();
    const headers: Record<string, string> = { "x-upsert": "true" };
    if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) headers.apikey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (sess.session?.access_token) headers.Authorization = `Bearer ${sess.session.access_token}`;

    const hashes: string[] = [];
    let done = 0;
    setTotal(file.size);
    for (let i = 0; i < n; i++) {
      if (signal.aborted) throw new Cancelled();
      const blob = multi ? file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE)) : file;
      setPart([i + 1, n]);
      if (multi) hashes.push(await sha256Hex(await blob.arrayBuffer()));
      const objPath = multi ? partPath(path, i) : path;
      if (multi && existing.get(objPath.split("/").pop()!) === blob.size) {
        done += blob.size;
        setLoaded(done);
        continue; // جزء مرفوع كاملاً سابقاً
      }
      await withRetry(async () => {
        const { data, error: e } = await supabase.storage.from(BUCKET).createSignedUploadUrl(objPath, { upsert: true });
        if (e || !data) throw new Error(e?.message ?? "signed url");
        await xhrUpload(data.signedUrl, blob, {
          method: "PUT",
          asForm: true,
          headers,
          signal,
          onProgress: (l) => setLoaded(done + l),
        });
      }, signal);
      done += blob.size;
      setLoaded(done);
    }

    setPhase("saving");
    const res = await registerFile({
      id: multi ? fileId : undefined,
      lessonId, kind, name: file.name, path, size: file.size,
      partCount: n,
      sha256: multi ? await manifestHash(hashes) : undefined,
      partSha256: multi ? hashes : undefined,
    });
    if (!res.ok || !res.id) throw new Error("register");
    lsSet(key, null);
    if (res.indexInBrowser) {
      setPhase("indexing");
      try {
        await indexPdfInBrowser(file, res.id, { signal, onProgress: (d, tt) => setIdx([d, tt]) });
      } catch (e) {
        if (e instanceof Cancelled) return; // الملف محفوظ؛ الفهرسة يمكن إعادتها من «اختبار البحث»
        console.error("browser indexing failed:", e);
      }
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError("");
    if (kind === "pdf" && !/\.pdf$/i.test(file.name)) return setError(t("content.pdfOnly"));
    const ac = new AbortController();
    abortRef.current = ac;
    setLoaded(0);
    setIdx([0, 0]);
    setPhase("uploading");
    try {
      await upload(file, ac.signal);
      if (inputRef.current) inputRef.current.value = "";
      setPhase("idle");
      router.refresh();
    } catch (err) {
      if (err instanceof Cancelled) return setPhase("cancelled");
      setPhase("idle");
      const msg = err instanceof Error ? err.message : "";
      setError(/413|exceeded|too large|maximum allowed/i.test(msg) ? t("content.fileTooBig").replace("{size}", mb(file.size)) : `${t("common.error")} · ${t("up.canResume")}`);
    }
  }

  async function discard() {
    const file = inputRef.current?.files?.[0];
    if (file) {
      const key = resumeKey(lessonId, file);
      const id = lsGet(key);
      if (id) {
        const supabase = createClient();
        const prefix = `${lessonId}/${id}`;
        const { data } = await supabase.storage.from(BUCKET).list(prefix, { limit: 2100 });
        if (data?.length) await supabase.storage.from(BUCKET).remove(data.map((o) => `${prefix}/${o.name}`));
        lsSet(key, null);
      }
    }
    setPhase("idle");
    setLoaded(0);
  }

  const pct = total ? Math.min(100, Math.round((loaded / total) * 100)) : 0;

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="fkind">{t("content.fileKind")}</label>
          <select id="fkind" className="input" value={kind} disabled={busy} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="pdf">{t("file.pdf")}</option>
            <option value="code">{t("file.code")}</option>
            <option value="data">{t("file.data")}</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="ffile">{t("content.upload")}</label>
          <input
            id="ffile"
            ref={inputRef}
            type="file"
            required
            disabled={busy}
            accept={kind === "pdf" ? "application/pdf,.pdf" : undefined}
            className="input !py-1.5 file:me-3 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-xs file:text-accent"
          />
        </div>
      </div>

      {(phase === "uploading" || phase === "saving" || phase === "indexing") && (
        <div className="space-y-1.5" role="status">
          <div className="h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={phase === "uploading" ? pct : 100} aria-valuemin={0} aria-valuemax={100} aria-label={t("content.uploading")}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${phase === "uploading" ? pct : 100}%` }} />
          </div>
          <p className="tech text-xs text-muted" dir="ltr">
            {phase === "uploading" && `${mb(loaded)} / ${mb(total)} MB · ${pct}%${part[1] > 1 ? ` · ${part[0]}/${part[1]}` : ""}`}
            {phase === "saving" && t("up.saving")}
            {phase === "indexing" && `${t("up.indexing")} ${idx[0]}/${idx[1]}`}
          </p>
          <button type="button" className="btn btn-sm" onClick={() => abortRef.current?.abort()}>
            <X size={14} aria-hidden /> {t("common.cancel")}
          </button>
        </div>
      )}

      {phase === "cancelled" && (
        <div className="space-y-2" role="status">
          <p className="text-sm text-muted">{t("up.cancelled")}</p>
          <button type="button" className="btn btn-sm" onClick={discard}>{t("up.discard")}</button>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn" aria-busy={busy}>
        <Upload size={16} aria-hidden /> {busy ? t("content.uploading") : phase === "cancelled" ? t("up.resume") : t("content.upload")}
      </button>
    </form>
  );
}
