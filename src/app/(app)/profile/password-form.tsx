"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useT } from "@/lib/i18n/client";

export function PasswordForm() {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg({ ok: false, text: t("reset.short") });
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: t("common.error") });
    setPassword("");
    setMsg({ ok: true, text: t("profile.passwordChanged") });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="newpw">{t("profile.newPassword")}</label>
        <input id="newpw" type="password" className="input" dir="ltr" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <button type="submit" disabled={busy || !password} className="btn">{t("profile.changePassword")}</button>
    </form>
  );
}
