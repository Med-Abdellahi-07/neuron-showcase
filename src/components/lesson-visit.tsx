"use client";

import { useEffect } from "react";
import { addRecent } from "@/lib/offline/db";

/** Records the most recently opened lessons (for the local list). Nothing sensitive: title and number only. */
export function LessonVisit({ id, title, kind, number, subject }: { id: string; title: string; kind: string; number: number; subject: string }) {
  useEffect(() => {
    addRecent({ id, title, kind, number, subject }).catch(() => {});
  }, [id, title, kind, number, subject]);
  return null;
}
