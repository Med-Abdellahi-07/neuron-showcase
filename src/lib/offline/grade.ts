import type { OfflineQuestion } from "./types.ts";

/** تصحيح محلي: answers[i] = فهرس الخيار المختار للسؤال i (أو -1) */
export function gradeLocal(questions: OfflineQuestion[], answers: number[]) {
  let correct = 0;
  const wrong: number[] = [];
  questions.forEach((q, i) => {
    if (answers[i] === q.correct) correct++;
    else wrong.push(i);
  });
  return { correct, total: questions.length, wrong, pct: questions.length ? Math.round((correct / questions.length) * 100) : 0 };
}
