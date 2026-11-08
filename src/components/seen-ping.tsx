"use client";

import { useEffect } from "react";
import { touchSeen } from "@/app/actions/seen";

/** Records "last seen" at most once every 10 minutes per tab (for the admin's student activity stats). */
export function SeenPing() {
  useEffect(() => {
    try {
      const last = Number(sessionStorage.getItem("neuron-seen") ?? "0");
      if (Date.now() - last < 10 * 60_000) return;
      sessionStorage.setItem("neuron-seen", String(Date.now()));
    } catch {
      /* Storage unavailable: send anyway. */
    }
    void touchSeen();
  }, []);
  return null;
}
