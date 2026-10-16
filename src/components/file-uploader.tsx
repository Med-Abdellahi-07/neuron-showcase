"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { registerFile } from "@/app/actions/content";
import { useT } from "@/lib/i18n/client";

const MAX_BYTES = 50 * 1024 * 1024;

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(-120) || "file";
}

export function FileUploader({ lessonId }: { lessonId: string }) {
  const { t } = useT();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<"pdf" | "code" | "data">("pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;
    setError("");
    if (file.size > MAX_BYTES) return setError("50MB max");
    if (kind === "pdf" && !/\.pdf$/i.test(file.name)) return setError("PDF only");

    setBusy(true);
    const path = `${lessonId}/${Date.now()}-${safeName(file.name)}`;
    const { error: upErr } = await createClient().storage.from("lesson-files").upload(path, file, {
      contentType: file.type || undefined,
      upsert: false,
    });
    if (upErr) {
      setBusy(false);
      return setError(t("common.error"));
    }
    const res = await registerFile({ lessonId, kind, name: file.name, path, size: file.size });
    setBusy(false);
    if (!res.ok) return setError(t("common.error"));
    if (inputRef.current) inputRef.current.value = "";
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="label" htmlFor="fkind">{t("content.fileKind")}</label>
          <select id="fkind" className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
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
            accept={kind === "pdf" ? "application/pdf,.pdf" : undefined}
            className="input !py-1.5 file:me-3 file:rounded file:border-0 file:bg-accent-soft file:px-2 file:py-1 file:text-xs file:text-accent"
          />
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="btn" aria-busy={busy}>
        <Upload size={16} aria-hidden /> {busy ? t("content.uploading") : t("content.upload")}
      </button>
    </form>
  );
}
