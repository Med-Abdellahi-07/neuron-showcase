/** Large-file upload/join: files over 45MB are split in the browser into parts of at most 45MB (Supabase's per-object limit is 50MB). */
export const PART_SIZE = 45 * 1024 * 1024;
export const INDEX_IN_BROWSER_OVER = 8 * 1024 * 1024; // PDFs larger than this are indexed from the browser (short batches).

export const partPath = (prefix: string, i: number) => `${prefix}/part-${String(i + 1).padStart(3, "0")}`;
export const partCountFor = (size: number) => Math.max(1, Math.ceil(size / PART_SIZE));

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash of a multipart file = sha256 of the concatenated part hashes (so 100MB+ never has to sit in memory at once). */
export async function manifestHash(partHashes: string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(partHashes.join("")).buffer as ArrayBuffer);
}

export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((res, rej) => {
    const t = setTimeout(res, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); rej(new Cancelled()); }, { once: true });
  });

/** Automatic retry (3 times, exponential backoff) for a single part; cancelling stops immediately. */
export async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, tries = 4): Promise<T> {
  let last: unknown;
  for (let a = 0; a < tries; a++) {
    if (signal?.aborted) throw new Cancelled();
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Cancelled) throw e;
      last = e;
      if (a < tries - 1) await sleep(600 * 2 ** a, signal);
    }
  }
  throw last;
}

/** Direct PUT/POST to Storage over XHR: real progress + cancel. Never goes through a Vercel function. */
export function xhrUpload(
  url: string,
  body: Blob,
  opts: { method?: string; headers?: Record<string, string>; onProgress?: (loaded: number) => void; signal?: AbortSignal; asForm?: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(new Cancelled());
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? "PUT", url);
    for (const [k, v] of Object.entries(opts.headers ?? {})) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => opts.onProgress?.(e.loaded);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`upload ${xhr.status} ${xhr.responseText.slice(0, 200)}`)));
    xhr.onerror = () => reject(new Error("network"));
    xhr.ontimeout = () => reject(new Error("timeout"));
    const onAbort = () => { xhr.abort(); reject(new Cancelled()); };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onloadend = () => opts.signal?.removeEventListener("abort", onAbort);
    if (opts.asForm) {
      const fd = new FormData();
      fd.append("cacheControl", "3600");
      fd.append("", body);
      xhr.send(fd);
    } else xhr.send(body);
  });
}

/** Fetches the parts (signed URLs) and joins them into one Blob, verifying hashes when present. */
export async function fetchJoined(
  urls: string[],
  opts: { hashes?: string[] | null; type?: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal }
): Promise<Blob> {
  const blobs: Blob[] = [];
  for (let i = 0; i < urls.length; i++) {
    const buf = await withRetry(async () => {
      const r = await fetch(urls[i], { signal: opts.signal });
      if (!r.ok) throw new Error(`part ${i + 1}: ${r.status}`);
      const b = await r.arrayBuffer();
      if (opts.hashes?.[i] && (await sha256Hex(b)) !== opts.hashes[i]) throw new Error(`part ${i + 1}: hash`);
      return b;
    }, opts.signal);
    blobs.push(new Blob([buf]));
    opts.onProgress?.(i + 1, urls.length);
  }
  return new Blob(blobs, { type: opts.type ?? "application/pdf" });
}
