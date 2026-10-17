"use client";

import { useState } from "react";
import { ExternalLink, Play } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { embedUrl, fmtTime, type Provider } from "@/lib/recordings";

export interface Mark {
  at_seconds: number;
  label: string;
}

/**
 * مشغّل التسجيل داخل الموقع. لا يُحمَّل شيء من YouTube/Drive قبل ضغط «تشغيل» (خصوصية + سرعة على الهاتف)،
 * وYouTube عبر youtube-nocookie. العلامات الزمنية (إن وُجدت) تنقل التشغيل إلى اللحظة المختارة.
 */
export function RecordingPlayer({ provider, videoId, title, marks = [] }: { provider: Provider; videoId: string; title: string; marks?: Mark[] }) {
  const { t } = useT();
  const [state, setState] = useState<{ on: boolean; start: number }>({ on: false, start: 0 });
  const external = provider === "youtube" ? `https://www.youtube.com/watch?v=${videoId}` : `https://drive.google.com/file/d/${videoId}/view`;

  return (
    <div className="space-y-2">
      <div className="relative aspect-video w-full overflow-hidden rounded-[var(--radius)] border border-border bg-surface-2">
        {state.on ? (
          <iframe
            key={state.start}
            src={embedUrl(provider, videoId, { start: state.start, autoplay: true })}
            title={title}
            className="absolute inset-0 size-full"
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        ) : (
          <button
            type="button"
            onClick={() => setState({ on: true, start: 0 })}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:bg-surface"
            aria-label={`${t("rec.play")}: ${title}`}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-fg">
              <Play size={26} aria-hidden className="ms-0.5" />
            </span>
            <span className="text-sm font-medium" dir="auto">{t("rec.play")}</span>
            <span className="text-[11px] text-muted">{t(provider === "youtube" ? "rec.loadsYoutube" : "rec.loadsDrive")}</span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {marks.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label={t("rec.marks")}>
            {marks.map((m) => (
              <li key={`${m.at_seconds}-${m.label}`}>
                <button type="button" className="btn btn-sm" onClick={() => setState({ on: true, start: m.at_seconds })}>
                  <span className="tech" dir="ltr">{fmtTime(m.at_seconds)}</span> <span dir="auto">{m.label}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}
        <a href={external} target="_blank" rel="noopener noreferrer" className="btn btn-sm">
          <ExternalLink size={14} aria-hidden /> {t(provider === "youtube" ? "rec.openYoutube" : "rec.openDrive")}
        </a>
      </div>
    </div>
  );
}
