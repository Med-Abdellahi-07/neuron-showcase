/** Parses a recording link: YouTube (regular/unlisted/Shorts/embed) or Google Drive. Only the id is stored. */
export type Provider = "youtube" | "drive";
export interface ParsedVideo {
  provider: Provider;
  video_id: string;
  /** Seconds, if t= or start= is present in a YouTube link. */
  start?: number;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,128}$/;

function toSeconds(v: string | null): number | undefined {
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!m || !(m[1] || m[2] || m[3])) return undefined;
  return (parseInt(m[1] ?? "0", 10) * 60 + parseInt(m[2] ?? "0", 10)) * 60 + parseInt(m[3] ?? "0", 10);
}

export function parseVideoUrl(raw: string): ParsedVideo | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^www\.|^m\./, "").toLowerCase();

  if (host === "youtu.be") {
    const id = u.pathname.split("/")[1] ?? "";
    return YT_ID.test(id) ? { provider: "youtube", video_id: id, start: toSeconds(u.searchParams.get("t")) } : null;
  }
  if (host === "youtube.com" || host === "youtube-nocookie.com" || host === "music.youtube.com") {
    const parts = u.pathname.split("/").filter(Boolean);
    let id = "";
    if (parts[0] === "watch") id = u.searchParams.get("v") ?? "";
    else if (["embed", "shorts", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? "";
    return YT_ID.test(id)
      ? { provider: "youtube", video_id: id, start: toSeconds(u.searchParams.get("t") ?? u.searchParams.get("start")) }
      : null;
  }
  if (host === "drive.google.com") {
    const m = u.pathname.match(/^\/file\/d\/([^/]+)/);
    const id = m?.[1] ?? u.searchParams.get("id") ?? "";
    return DRIVE_ID.test(id) ? { provider: "drive", video_id: id } : null;
  }
  return null;
}

/** Embed URL. YouTube goes through youtube-nocookie (no cookies before playback). */
export function embedUrl(provider: Provider, id: string, opts: { start?: number; autoplay?: boolean } = {}): string {
  if (provider === "drive") return `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview`;
  const p = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (opts.start && opts.start > 0) p.set("start", String(Math.floor(opts.start)));
  if (opts.autoplay) p.set("autoplay", "1");
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${p}`;
}

/** 90 -> 1:30, 3725 -> 1:02:05 */
export const fmtTime = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, "0")}` : `${m}`) + `:${String(sec).padStart(2, "0")}`;
};
