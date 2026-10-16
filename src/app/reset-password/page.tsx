"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { useT } from "@/lib/i18n/client";
import { Logo } from "@/components/logo";

export default function ResetPasswordPage() {
  const { t } = useT();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError(t("reset.short"));
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(t("common.error"));
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-5 py-10">
      <Logo />
      <h1 className="page-title !mb-0">{t("reset.title")}</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input type="password" className="input" dir="ltr" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="btn btn-primary w-full">{t("reset.submit")}</button>
      </form>
    </main>
  );
}
