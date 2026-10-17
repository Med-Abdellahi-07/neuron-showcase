"use client";

import { useEffect } from "react";
import { touchSeen } from "@/app/actions/seen";

/** يُسجّل «آخر ظهور» مرة كل 10 دقائق كحد أقصى لكل تبويب (لإحصاءات نشاط الطلاب عند المدير). */
export function SeenPing() {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem("neuron-seen") ?? "0");
      if (Date.now() - last < 10 * 60_000) return;
      sessionStorage.setItem("neuron-seen", String(Date.now()));
    } catch {
      /* التخزين غير متاح: نرسل على أي حال */
    }
    void touchSeen();
  }, []);
  return null;
}
