"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { generateVapidKeys } from "@/app/actions/push";

function randomHex(bytes: number) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** يولّد مفاتيح VAPID وسرّ Cron في المتصفح/الخادم دون أي طرفية. تُنسخ مباشرة إلى Vercel ولا تُلصق في أي دردشة. */
export function VapidGenerator() {
  const { t } = useT();
  const [vars, setVars] = useState<{ name: string; value: string }[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    startTransition(async () => {
      const k = await generateVapidKeys();
      setVars([
        { name: "VAPID_PUBLIC_KEY", value: k.publicKey },
        { name: "VAPID_PRIVATE_KEY", value: k.privateKey },
        { name: "VAPID_SUBJECT", value: "mailto:" + "YOUR-EMAIL@example.com" },
        { name: "CRON_SECRET", value: randomHex(24) },
      ]);
    });
  }

  async function copy(name: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(name);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* المستخدم ينسخ يدوياً */
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-primary" onClick={generate} disabled={pending}>
        <KeyRound size={16} aria-hidden /> {t("notif.admin.generate")}
      </button>
      {vars && (
        <div className="space-y-2">
          <p className="rounded-[var(--radius)] bg-warn/10 p-3 text-sm text-warn" role="alert">{t("notif.admin.warn")}</p>
          <ul className="space-y-2">
            {vars.map((v) => (
              <li key={v.name} className="rounded-[var(--radius)] border border-border p-2" dir="ltr">
                <div className="flex items-center justify-between gap-2">
                  <span className="tech text-xs font-semibold">{v.name}</span>
                  <button type="button" className="btn btn-sm" onClick={() => copy(v.name, v.value)}>
                    <Copy size={14} aria-hidden /> {copied === v.name ? <Check size={14} strokeWidth={1.9} aria-hidden /> : t("chat.copy")}
                  </button>
                </div>
                <code className="mt-1 block break-all text-xs text-muted">{v.value}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
