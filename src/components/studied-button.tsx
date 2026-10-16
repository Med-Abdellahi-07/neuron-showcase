"use client";

import { useOptimistic, useTransition } from "react";
import { Check } from "lucide-react";
import { toggleStudied } from "@/app/actions/progress";
import { useT } from "@/lib/i18n/client";

export function StudiedButton({ lessonId, studied }: { lessonId: string; studied: boolean }) {
  const { t } = useT();
  const [pending, start] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic(studied);

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={optimistic}
      onClick={() =>
        start(async () => {
          setOptimistic(!optimistic);
          await toggleStudied(lessonId, !optimistic);
        })
      }
      className={`btn w-full ${optimistic ? "badge-accent !border-transparent" : "btn-primary"}`}
    >
      {optimistic && <Check size={16} aria-hidden />}
      {optimistic ? t("lesson.studiedDone") : t("lesson.studied")}
    </button>
  );
}
