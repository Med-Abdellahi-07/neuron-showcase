"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { useT } from "@/lib/i18n/client";

export function LoginForm() {
  const { t } = useT();
  const [state, action] = useActionState<FormState, FormData>(login, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label !text-[13px]" htmlFor="identifier">{t("login.identifier")}</label>
        <input id="identifier" name="identifier" className="input !min-h-12 !text-[15px]" autoComplete="username" inputMode="email" dir="ltr" required />
      </div>
      <div>
        <label className="label !text-[13px]" htmlFor="password">{t("login.password")}</label>
        <input id="password" name="password" type="password" className="input !min-h-12 !text-[15px]" autoComplete="current-password" dir="ltr" required />
      </div>
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <SubmitButton className="btn btn-primary w-full !min-h-[52px] !rounded-2xl !text-base !font-semibold">{t("login.submit")}</SubmitButton>
      <p className="text-center text-sm">
        <Link href="/forgot" className="text-accent hover:underline">{t("login.forgot")}</Link>
      </p>
    </form>
  );
}
