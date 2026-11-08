"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import { Rich } from "@/components/rich";

export interface Card { front: string; back: string; page: number | null }

/** Memorization cards: tap to flip, arrows to navigate. */
export function Flashcards({ cards }: { cards: Card[] }) {
  const { t } = useT();
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const c = cards[i];
  if (!c) return null;
  const go = (d: number) => { setI((x) => Math.min(cards.length - 1, Math.max(0, x + d))); setFlip(false); };
  return (
    <div className="space-y-3">
      <button type="button" onClick={() => setFlip((f) => !f)} aria-live="polite"
        className="card flex min-h-48 w-full flex-col items-center justify-center gap-2 text-center" aria-label={flip ? t("sum.cardBack") : t("sum.cardFront")}>
        <span className="tech text-xs text-muted">{flip ? t("sum.cardBack") : t("sum.cardFront")}{c.page ? ` · p. ${c.page}` : ""}</span>
        <Rich>{flip ? c.back : c.front}</Rich>
        <span className="text-xs text-muted">{t("sum.flip")}</span>
      </button>
      <div className="flex items-center justify-between">
        <button type="button" className="btn btn-sm" onClick={() => go(-1)} disabled={i === 0} aria-label={t("common.back")}><ChevronRight size={16} aria-hidden className="rtl:hidden" /><ChevronLeft size={16} aria-hidden className="hidden rtl:block" /></button>
        <span className="tech text-xs text-muted" dir="ltr">{i + 1} / {cards.length}</span>
        <button type="button" className="btn btn-sm" onClick={() => go(1)} disabled={i === cards.length - 1} aria-label={t("sum.next")}><ChevronLeft size={16} aria-hidden className="rtl:hidden" /><ChevronRight size={16} aria-hidden className="hidden rtl:block" /></button>
      </div>
    </div>
  );
}
