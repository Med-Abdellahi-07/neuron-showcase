"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { CornerUpLeft, Send, Trash2, VolumeX, X, WifiOff } from "lucide-react";
import { deleteSpaceMessage, muteSpaceMember, sendSpaceMessage } from "@/app/actions/space-chat";
import { dayKey, mergeMessages, nameColor } from "@/lib/chat-format";
import { useT } from "@/lib/i18n/client";

interface Msg {
  id: number;
  user_id: string;
  name: string;
  staff: boolean;
  body: string;
  reply_to: number | null;
  created_at: string;
  mine: boolean;
}
interface Room {
  messages: Msg[];
  muted_until: string | null;
  staff: boolean;
}

const POLL_MS = 5000;
const PAGE = 40;

export function SpaceChat() {
  const { t, locale } = useT();
  const [older, setOlder] = useState<Msg[]>([]);
  const [latest, setLatest] = useState<Msg[]>([]);
  const [muted, setMuted] = useState<string | null>(null);
  const [staff, setStaff] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Msg | null>(null);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState<number | null>(null);
  const [muteFor, setMuteFor] = useState<string | null>(null);
  const stick = useRef(true);

  const fetchRoom = useCallback(async (qs: string): Promise<Room | null> => {
    try {
      const r = await fetch(`/api/space-chat?${qs}`, { cache: "no-store" });
      if (!r.ok) return null;
      setOffline(false);
      return (await r.json()) as Room;
    } catch {
      setOffline(true);
      return null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const d = await fetchRoom(`limit=${PAGE}`);
    if (!d) return;
    setLatest(d.messages);
    setMuted(d.muted_until);
    setStaff(d.staff);
    setHasMore((h) => (older.length ? h : d.messages.length >= PAGE));
    setLoaded(true);
  }, [fetchRoom, older.length]);

  // تحميل أولي + تحديث دوري (متوقف والصفحة مخفية)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const tick = () => { if (document.visibilityState === "visible") refresh(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", tick); };
  }, [refresh]);

  const all = mergeMessages(older, latest);
  const byId = new Map(all.map((m) => [m.id, m]));

  // التمرير للأسفل عند الوصول رسائل جديدة إن كان المستخدم قرب النهاية
  useLayoutEffect(() => {
    if (stick.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [all.length, loaded]);
  useEffect(() => {
    const onScroll = () => {
      const el = document.scrollingElement ?? document.documentElement;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  async function loadOlder() {
    const first = all[0]?.id;
    if (!first) return;
    stick.current = false;
    const d = await fetchRoom(`before=${first}&limit=${PAGE}`);
    if (!d) return;
    setOlder((o) => [...d.messages, ...o]);
    setHasMore(d.messages.length >= PAGE);
  }

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setErr("");
    const res = await sendSpaceMessage(body, reply?.id ?? null);
    setSending(false);
    if (!res.ok) {
      setErr(t(res.error === "muted" ? "sc.muted" : res.error === "rate_limited" ? "sc.rate" : "sc.err"));
      return;
    }
    setText("");
    setReply(null);
    stick.current = true;
    await refresh();
  }

  async function del(id: number) {
    setConfirmDel(null);
    if (await deleteSpaceMessage(id)) {
      setOlder((o) => o.filter((m) => m.id !== id));
      setLatest((l) => l.filter((m) => m.id !== id));
    }
  }

  async function mute(m: Msg, hours: number) {
    setMuteFor(null);
    const r = await muteSpaceMember(m.user_id, hours);
    setErr(r.ok ? "" : t("sc.err"));
  }

  const timeFmt = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" });
  const dayFmt = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" });
  const mutedActive = muted && new Date(muted) > new Date();

  return (
    <div className="flex flex-col gap-3">
      <h1 className="page-title !mb-0">{t("sc.title")}</h1>
      <p className="text-xs text-muted">{t("sc.hint")}</p>
      {offline && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-urgent-bg px-3 py-2 text-xs font-medium text-urgent"><WifiOff size={14} aria-hidden /> {t("sc.offline")}</p>
      )}

      {hasMore && loaded && all.length >= PAGE && (
        <button type="button" onClick={loadOlder} className="btn btn-sm self-center">{t("sc.older")}</button>
      )}
      {loaded && all.length === 0 && <p className="card text-center text-sm text-muted">{t("sc.empty")}</p>}
      {!loaded && <p className="text-center text-sm text-muted">…</p>}

      <ul className="flex flex-col gap-2" aria-live="polite">
        {all.map((m, i) => {
          const prev = all[i - 1];
          const newDay = !prev || dayKey(prev.created_at) !== dayKey(m.created_at);
          const grouped = !newDay && prev && prev.user_id === m.user_id;
          const quoted = m.reply_to ? byId.get(m.reply_to) : null;
          return (
            <li key={m.id} className="flex flex-col">
              {newDay && <p className="my-2 self-center rounded-full bg-surface-2 px-3 py-0.5 text-[11px] text-muted">{dayFmt.format(new Date(m.created_at))}</p>}
              <div className={`group flex flex-col ${m.mine ? "items-end" : "items-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.mine ? "bg-accent text-white" : "bg-surface"} ${grouped ? "mt-0" : "mt-1"}`}>
                  {!m.mine && !grouped && (
                    <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold" style={{ color: nameColor(m.user_id) }} dir="auto">
                      {m.name}
                      {m.staff && <span className="rounded bg-accent-soft px-1 text-[10px] font-semibold text-accent">{t("sc.staff")}</span>}
                    </p>
                  )}
                  {m.reply_to && (
                    <p className={`mb-1 line-clamp-2 border-s-2 ps-2 text-xs ${m.mine ? "border-white/60 text-white/85" : "border-accent text-muted"}`} dir="auto">
                      {quoted ? `${quoted.name}: ${quoted.body}` : t("sc.deleted")}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words leading-6" dir="auto"><ChatText text={m.body} /></p>
                  <p className={`tech mt-0.5 text-end text-[10px] ${m.mine ? "text-white/75" : "text-faint"}`} dir="ltr">{timeFmt.format(new Date(m.created_at))}</p>
                </div>
                <div className="mt-0.5 flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" className="btn btn-sm !min-h-8 !px-2" onClick={() => { setReply(m); document.getElementById("sc-input")?.focus(); }} aria-label={t("sc.reply")}><CornerUpLeft size={13} aria-hidden /></button>
                  {(m.mine || staff) && (
                    confirmDel === m.id ? (
                      <>
                        <button type="button" className="btn btn-sm !min-h-8 !border-danger !text-danger" onClick={() => del(m.id)}>{t("sc.confirmDel")}</button>
                        <button type="button" className="btn btn-sm !min-h-8 !px-2" onClick={() => setConfirmDel(null)} aria-label={t("common.cancel")}><X size={13} aria-hidden /></button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-sm !min-h-8 !px-2" onClick={() => setConfirmDel(m.id)} aria-label={t("sc.delete")}><Trash2 size={13} aria-hidden /></button>
                    )
                  )}
                  {staff && !m.mine && !m.staff && (
                    muteFor === m.user_id + m.id ? (
                      <>
                        <button type="button" className="btn btn-sm !min-h-8" onClick={() => mute(m, 1)}>{t("sc.mute1")}</button>
                        <button type="button" className="btn btn-sm !min-h-8" onClick={() => mute(m, 24)}>{t("sc.mute24")}</button>
                        <button type="button" className="btn btn-sm !min-h-8 !px-2" onClick={() => setMuteFor(null)} aria-label={t("common.cancel")}><X size={13} aria-hidden /></button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-sm !min-h-8 !px-2" onClick={() => setMuteFor(m.user_id + m.id)} aria-label={t("sc.mute")}><VolumeX size={13} aria-hidden /></button>
                    )
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-[calc(96px+env(safe-area-inset-bottom))] z-10 space-y-2 rounded-2xl bg-surface p-2 shadow-[var(--shadow-float)] md:bottom-4">
        {reply && (
          <p className="flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-xs" dir="auto">
            <CornerUpLeft size={13} aria-hidden className="shrink-0" />
            <span className="line-clamp-1 min-w-0 grow">{reply.name}: {reply.body}</span>
            <button type="button" onClick={() => setReply(null)} aria-label={t("common.cancel")}><X size={14} aria-hidden /></button>
          </p>
        )}
        {err && <p role="alert" className="px-2 text-xs text-danger">{err}</p>}
        {mutedActive ? (
          <p className="px-3 py-2 text-sm text-muted">{t("sc.mutedUntil").replace("{t}", new Date(muted!).toLocaleString(locale))}</p>
        ) : (
          <div className="flex items-end gap-2">
            <textarea
              id="sc-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}
              rows={1}
              maxLength={1000}
              dir="auto"
              placeholder={t("sc.placeholder")}
              aria-label={t("sc.placeholder")}
              className="input max-h-32 min-h-11 grow resize-none"
            />
            <button type="button" onClick={send} disabled={sending || !text.trim()} className="btn btn-primary !size-11 !p-0" aria-label={t("chat.send")}>
              <Send size={18} aria-hidden className="rtl:-scale-x-100" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** نص عادي مع معادلات $...$ فقط عبر KaTeX (بلا HTML خام ولا روابط ولا صور، فمحتوى الزملاء غير موثوق) */
function ChatText({ text }: { text: string }) {
  const parts = text.split(/(\$\$[^$]+\$\$|\$[^$\n]+\$)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (i % 2 === 0) return p;
        const display = p.startsWith("$$");
        const tex = p.slice(display ? 2 : 1, display ? -2 : -1);
        if (!/[\\^_{}=<>+\-*/]/.test(tex) && tex.trim().length > 2) return p; // «$5 و $6» نص عادي لا معادلة
        try {
          const html = katex.renderToString(tex, { displayMode: display, throwOnError: true, trust: false, strict: "ignore", maxExpand: 200 });
          return <span key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        } catch {
          return p;
        }
      })}
    </>
  );
}
