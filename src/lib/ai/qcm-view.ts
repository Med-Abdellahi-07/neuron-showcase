import type { AiQ } from "@/components/ai-qcm-runner";

/** Turns ai_questions rows into browser data: the correct answer is only sent for questions already answered. */
export function toAiQ(rows: Record<string, unknown>[], lessonLabel: Map<string, string>): AiQ[] {
  return rows.map((r) => {
    const answered = r.selected !== null && r.selected !== undefined;
    return {
      id: r.id as string,
      statement: r.statement as string,
      options: r.options as string[],
      page: (r.page as number | null) ?? null,
      lesson: r.lesson_id ? (lessonLabel.get(r.lesson_id as string) ?? null) : null,
      selected: answered ? (r.selected as number) : null,
      correctIndex: answered ? (r.correct_index as number) : null,
      explanation: answered ? (r.explanation as string) : null,
      reported: !!r.report_status,
    };
  });
}
