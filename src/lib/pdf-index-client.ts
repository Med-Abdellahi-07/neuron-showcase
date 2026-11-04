import { finishClientIndex, indexPages, startClientIndex } from "@/app/actions/index-client";

/**
 * يستخرج نص PDF في المتصفح (pdf.js عبر unpdf) ويرسله لفهرسة المساعد دفعات صغيرة (10 صفحات).
 * كل دفعة استدعاء قصير، فلا مهلة على الكتب الكبيرة. PDF ممسوح ضوئياً (بلا نص) ← يُسجَّل «لا نص» كما في الفهرسة القديمة.
 */
export async function indexPdfInBrowser(
  file: Blob,
  fileId: string,
  opts: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<{ pages: number; chunks: number }> {
  const start = await startClientIndex(fileId);
  if (!start.ok) return { pages: 0, chunks: 0 };
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  const total = pdf.numPages;
  let chunks = 0;
  let embedError: string | undefined;
  const BATCH = 10;
  for (let from = 1; from <= total; from += BATCH) {
    if (opts.signal?.aborted) break;
    const batch: { page: number; text: string }[] = [];
    for (let p = from; p < Math.min(from + BATCH, total + 1); p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      let text = "";
      for (const it of content.items as { str?: string; hasEOL?: boolean }[]) text += (it.str ?? "") + (it.hasEOL ? "\n" : " ");
      batch.push({ page: p, text });
      page.cleanup();
    }
    const r = await indexPages(fileId, batch);
    if (!r.ok) throw new Error("index batch failed");
    chunks += r.chunks;
    embedError ??= r.embedError;
    opts.onProgress?.(Math.min(from + BATCH - 1, total), total);
  }
  await finishClientIndex(fileId, chunks, embedError);
  return { pages: total, chunks };
}
