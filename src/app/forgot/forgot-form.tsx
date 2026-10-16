"use client";

import { useActionState } from "react";
import { requestReset, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { useT } from "@/lib/i18n/client";

export function ForgotForm() {
  const { t } = useT();
  const [state, action] = useActionState<FormState, FormData>(requestReset, null);
  return (
    <form action={action} className="space-y-4">
      <input name="email" type="email" className="input" dir="ltr" autoComplete="email" required />
      {state?.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      <SubmitButton className="btn btn-primary w-full">{t("forgot.send")}</SubmitButton>
    </form>
  );
}
