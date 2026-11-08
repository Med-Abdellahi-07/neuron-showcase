"use client";

import { useActionState, useEffect, useRef, useTransition, type ReactNode } from "react";
import type { FormState } from "@/app/actions/auth";

/**
 * Form that calls a Server Action and shows the success/error message.
 * The action is called manually inside a transition so React does not clear the fields on error.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  className = "space-y-4",
  submitClassName = "btn btn-primary",
  resetOnSuccess = false,
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  submitLabel: string;
  children: ReactNode;
  className?: string;
  submitClassName?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.message && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => dispatch(fd));
      }}
    >
      {children}
      {state?.error && (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      )}
      <button type="submit" disabled={pending} className={submitClassName} aria-busy={pending}>
        {submitLabel}
      </button>
    </form>
  );
}
