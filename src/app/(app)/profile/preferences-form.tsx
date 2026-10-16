"use client";

import { useActionState } from "react";
import { updatePreferences } from "@/app/actions/profile";
import type { FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { useT } from "@/lib/i18n/client";

export function PreferencesForm({
  englishGroup,
  hideFromRanking,
  groupOptions,
}: {
  englishGroup: string;
  hideFromRanking: boolean;
  groupOptions: string[];
}) {
  const { t } = useT();
  const [state, action] = useActionState<FormState, FormData>(updatePreferences, null);
  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="label" htmlFor="english_group">{t("profile.englishGroup")}</label>
        <input id="english_group" name="english_group" className="input" dir="ltr" list="groups" defaultValue={englishGroup} maxLength={40} />
        <datalist id="groups">
          {groupOptions.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>
        <p className="mt-1 text-xs text-muted">{t("profile.englishHint")}</p>
      </div>
      <label className="flex min-h-10 items-center gap-3 text-sm">
        <input type="checkbox" name="hide_from_ranking" defaultChecked={hideFromRanking} className="size-4 accent-[var(--accent)]" />
        {t("profile.hideRanking")}
      </label>
      {state?.message && <p role="status" className="text-sm text-success">{state.message}</p>}
      {state?.error && <p role="alert" className="text-sm text-danger">{state.error}</p>}
      <SubmitButton>{t("common.save")}</SubmitButton>
    </form>
  );
}
