"use client";

import { useEffect } from "react";
import { addRecent } from "@/lib/offline/db";

/** يسجّل آخر الحصص المفتوحة (للقائمة المحلية). لا شيء حساس: العنوان والرقم فقط. */
export function LessonVisit({ id, title, kind, number, subject }: { id: string; title: string; kind: string; number: number; subject: string }) {
  useEffect(() => {
    addRecent({ id, title, kind, number, subject }).catch(() => {});
  }, [id, title, kind, number, subject]);
  return null;
}
