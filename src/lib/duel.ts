/** Shared types and helpers for the duel pages (outside the page files because Next restricts what they export). */
export type DuelStatus = "challenger_turn" | "open" | "completed" | "expired";

export interface DuelItem {
  id: string;
  status: DuelStatus;
  expires_at: string | null;
  subject_id: string | null;
  total: number;
  i_am_challenger: boolean;
  opponent_name: string;
  my_finished: boolean;
  my_answered: number;
  result: { won: boolean; draw: boolean } | null;
}

export interface DuelPlayer {
  user_id: string;
  name: string;
  finished: boolean;
  answered: number;
  correct: number;
  points: number;
  total_ms: number;
}

export interface DuelResultQuestion {
  id: string;
  statement: string;
  options: string[];
  correct_index: number;
  explanation: string | null;
  answers: { user_id: string; selected_index: number; is_correct: boolean; elapsed_ms: number }[] | null;
}

export interface DuelResult {
  status: DuelStatus | "cancelled";
  expires_at: string | null;
  i_am_challenger: boolean;
  my_finished?: boolean;
  winner_id?: string | null;
  is_draw?: boolean;
  me?: string;
  players?: DuelPlayer[];
  questions?: DuelResultQuestion[];
}

export function hoursLeft(iso: string | null): number {
  return iso ? Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 3600_000)) : 0;
}
