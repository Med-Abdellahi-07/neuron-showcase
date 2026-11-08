"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, GraduationCap, Layers, Lock } from "lucide-react";
import { login, type FormState } from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import { useT } from "@/lib/i18n/client";
import { isRtl } from "@/lib/i18n/dictionaries";
import { pickName, type Directory, type DirectoryInstitution, type DirectoryMajor, type DirectorySpace } from "@/lib/space-model";

type Step = "institution" | "major" | "level" | "form";

/**
 * Four-step login: institution -> major -> level -> login form.
 * The chosen space is sent with the form and the server checks the account belongs to it.
 * A space without an admin (not activated) shows greyed out as "coming soon" and cannot be opened.
 */
export function SpaceLogin({ directory, initialSpaceId }: { directory: Directory; initialSpaceId: string | null }) {
  const { t, locale } = useT();
  const rtl = isRtl(locale);
  const Back = rtl ? ArrowRight : ArrowLeft;

  const index = useMemo(() => {
    const map = new Map<string, { inst: DirectoryInstitution; major: DirectoryMajor; space: DirectorySpace }>();
    for (const inst of directory.institutions)
      for (const major of inst.majors) for (const space of major.spaces) map.set(space.id, { inst, major, space });
    return map;
  }, [directory]);

  const remembered = initialSpaceId ? index.get(initialSpaceId) : undefined;
  const [step, setStep] = useState<Step>(remembered?.space.open ? "form" : "institution");
  const [inst, setInst] = useState<DirectoryInstitution | null>(remembered?.space.open ? remembered.inst : null);
  const [major, setMajor] = useState<DirectoryMajor | null>(remembered?.space.open ? remembered.major : null);
  const [space, setSpace] = useState<DirectorySpace | null>(remembered?.space.open ? remembered.space : null);
  const [state, action] = useActionState<FormState, FormData>(login, null);

  const hasOpen = (m: DirectoryMajor) => m.spaces.some((s) => s.open);
  const spaceName = major && space ? `${major.code} ${space.level}` : "";

  const back = () => {
    if (step === "form") setStep("level");
    else if (step === "level") setStep("major");
    else if (step === "major") setStep("institution");
  };

  const tile = "press flex h-full min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-[20px] border border-[var(--border-input)] bg-[var(--input-bg)] p-4 text-center transition-colors";
  const tileOff = "flex h-full min-h-[4.5rem] w-full flex-col items-center justify-center gap-1 rounded-[20px] bg-surface-2 p-4 text-center opacity-60";

  return (
    <div className="space-y-5">
      {step !== "institution" && (
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={back} className="press inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-muted hover:text-fg">
            <Back size={16} aria-hidden /> {t("login.back")}
          </button>
          {inst && (
            <p className="tech truncate text-xs text-muted" dir="ltr">
              {[inst.code, major?.code, step === "form" ? space?.level : null].filter(Boolean).join(" › ")}
            </p>
          )}
        </div>
      )}

      {step === "institution" && (
        <section aria-labelledby="step-inst" className="space-y-3">
          <h2 id="step-inst" className="flex items-center gap-2 text-sm font-semibold text-muted">
            <Building2 size={16} aria-hidden /> {t("login.pickInstitution")}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {directory.institutions.map((i) => (
              <li key={i.id}>
                <button
                  type="button"
                  className={tile}
                  onClick={() => {
                    setInst(i);
                    setMajor(null);
                    setSpace(null);
                    setStep("major");
                  }}
                >
                  <span className="tech text-2xl font-bold text-accent" dir="ltr">{i.code}</span>
                  <span className="text-[11px] leading-snug text-muted" dir="auto">{pickName(i.name, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "major" && inst && (
        <section aria-labelledby="step-major" className="space-y-3">
          <h2 id="step-major" className="flex items-center gap-2 text-sm font-semibold text-muted">
            <GraduationCap size={16} aria-hidden /> {t("login.pickMajor")}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {inst.majors.map((m) => {
              const open = hasOpen(m);
              const body = (
                <>
                  <span className="tech text-2xl font-bold text-accent" dir="ltr">{m.code}</span>
                  <span className="text-[11px] leading-snug text-muted" dir="auto">{pickName(m.name, locale)}</span>
                  {!open && (
                    <span className="badge mt-1 inline-flex items-center gap-1"><Lock size={11} aria-hidden /> {t("login.soon")}</span>
                  )}
                </>
              );
              return (
                <li key={m.id}>
                  {open ? (
                    <button
                      type="button"
                      className={tile}
                      onClick={() => {
                        setMajor(m);
                        setSpace(null);
                        setStep("level");
                      }}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={tileOff} aria-disabled="true">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {step === "level" && major && (
        <section aria-labelledby="step-level" className="space-y-3">
          <h2 id="step-level" className="flex items-center gap-2 text-sm font-semibold text-muted">
            <Layers size={16} aria-hidden /> {t("login.pickLevel")}
          </h2>
          <ul className="grid grid-cols-2 gap-3">
            {major.spaces.map((s) => (
              <li key={s.id}>
                {s.open ? (
                  <button
                    type="button"
                    className={tile}
                    onClick={() => {
                      setSpace(s);
                      setStep("form");
                    }}
                  >
                    <span className="tech text-2xl font-bold text-accent" dir="ltr">{s.level}</span>
                  </button>
                ) : (
                  <div className={tileOff} aria-disabled="true">
                    <span className="tech text-2xl font-bold" dir="ltr">{s.level}</span>
                    <span className="badge inline-flex items-center gap-1"><Lock size={11} aria-hidden /> {t("login.soon")}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === "form" && space && (
        <form action={action} className="space-y-4">
          <input type="hidden" name="space_id" value={space.id} />
          <div className="rounded-[20px] bg-accent-soft p-4 text-center">
            <p className="text-xs text-muted">{t("login.space")}</p>
            <p className="tech text-2xl font-bold text-accent" dir="ltr">{spaceName}</p>
            {major && <p className="mt-0.5 text-xs text-muted" dir="auto">{pickName(major.name, locale)}</p>}
          </div>
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
          <p className="flex items-center justify-between gap-3 text-sm">
            <button type="button" onClick={() => setStep("institution")} className="text-accent hover:underline">{t("login.changeSpace")}</button>
            <Link href="/forgot" className="text-accent hover:underline">{t("login.forgot")}</Link>
          </p>
        </form>
      )}
    </div>
  );
}
