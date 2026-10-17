"use client";

import { useEffect, useState, useTransition } from "react";
import { Bell, BellOff, Share, SquarePlus } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { removePushSubscription, savePushPrefs, savePushSubscription, sendTestPush } from "@/app/actions/push";
import type { DictKey } from "@/lib/i18n/dictionaries";

const KINDS = ["lesson_tomorrow", "schedule_change", "new_content", "duel", "review", "announcement"] as const;
type Kind = (typeof KINDS)[number];

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const toB64 = (buf: ArrayBuffer | null) => (buf ? btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : "");

type Env = "loading" | "unsupported" | "ios-install" | "ready";

export function NotificationSettings({ publicKey, initial }: { publicKey: string; initial: Record<Kind, boolean> }) {
  const { t } = useT();
  const [env, setEnv] = useState<Env>("loading");
  const [perm, setPerm] = useState<NotificationPermission>("default");
  const [subscribed, setSubscribed] = useState(false);
  const [prefs, setPrefs] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ua = navigator.userAgent;
      const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (cancelled) return;
      if (ios && !standalone) return setEnv("ios-install");
      if (!supported) return setEnv("unsupported");
      setEnv("ready");
      setPerm(Notification.permission);
      try {
        const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
        if (reg && !cancelled) setSubscribed(!!(await reg.pushManager.getSubscription()));
      } catch {
        /* لا اشتراك */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function enable() {
    setMsg(null);
    startTransition(async () => {
      try {
        const p = await Notification.requestPermission();
        setPerm(p);
        if (p !== "granted") return setMsg(t("notif.denied"));
        const reg = await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
        const r = await savePushSubscription(
          { endpoint: sub.endpoint, p256dh: toB64(sub.getKey("p256dh")), auth: toB64(sub.getKey("auth")) },
          navigator.userAgent
        );
        if (!r.ok) return setMsg(t("common.error"));
        setSubscribed(true);
        setMsg(t("notif.enabled"));
      } catch {
        setMsg(t("notif.failed"));
      }
    });
  }

  function disable() {
    setMsg(null);
    startTransition(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await removePushSubscription(sub.endpoint);
          await sub.unsubscribe();
        }
        setSubscribed(false);
      } catch {
        setMsg(t("notif.failed"));
      }
    });
  }

  function toggle(k: Kind, v: boolean) {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    void savePushPrefs(next);
  }

  function test() {
    setMsg(null);
    startTransition(async () => {
      const r = await sendTestPush();
      setMsg(r.ok ? t("notif.testSent") : t(r.reason === "no_device" ? "notif.testNoDevice" : r.reason === "not_configured" ? "notif.notConfigured" : "notif.failed"));
    });
  }

  if (env === "loading") return <p className="text-sm text-muted">…</p>;

  if (env === "ios-install")
    return (
      <div className="space-y-3 text-sm">
        <p>{t("notif.iosIntro")}</p>
        <ol className="space-y-2">
          <li className="flex items-start gap-2"><Share size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> {t("notif.iosStep1")}</li>
          <li className="flex items-start gap-2"><SquarePlus size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> {t("notif.iosStep2")}</li>
          <li className="flex items-start gap-2"><Bell size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden /> {t("notif.iosStep3")}</li>
        </ol>
      </div>
    );

  if (env === "unsupported") return <p className="text-sm text-muted">{t("notif.unsupported")}</p>;

  if (!publicKey) return <p className="text-sm text-muted">{t("notif.notConfigured")}</p>;

  return (
    <div className="space-y-4">
      {perm === "denied" && <p role="alert" className="text-sm text-warn">{t("notif.blocked")}</p>}
      <div className="flex flex-wrap gap-2">
        {subscribed ? (
          <>
            <button type="button" className="btn" onClick={disable} disabled={pending}>
              <BellOff size={16} aria-hidden /> {t("notif.disable")}
            </button>
            <button type="button" className="btn" onClick={test} disabled={pending}>{t("notif.test")}</button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={enable} disabled={pending || perm === "denied"}>
            <Bell size={16} aria-hidden /> {t("notif.enable")}
          </button>
        )}
      </div>
      {msg && <p role="status" className="text-sm text-muted">{msg}</p>}
      <fieldset className="space-y-1" disabled={!subscribed}>
        <legend className="label">{t("notif.types")}</legend>
        {KINDS.map((k) => (
          <label key={k} className="flex min-h-10 items-center gap-3 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={prefs[k]} onChange={(e) => toggle(k, e.target.checked)} />
            {t(`notif.k.${k}` as DictKey)}
          </label>
        ))}
        {!subscribed && <p className="text-xs text-muted">{t("notif.typesHint")}</p>}
      </fieldset>
    </div>
  );
}
