export type Role = "student" | "moderator" | "admin";
export type LessonKind = "cm" | "td" | "tp" | "resume";
export type SessionKind = "cm" | "td" | "tp";
export type Status = "draft" | "pending" | "published";
export type Difficulty = "easy" | "medium" | "hard";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  can_publish_direct: boolean;
  cohort_id: string | null;
  locale: "ar" | "fr";
  english_group: string | null;
  hide_from_ranking: boolean;
}

export interface Subject {
  id: string;
  semester_id: string;
  code: string;
  name: string;
  credits: number;
  cm_hours: number;
  td_hours: number;
  tp_hours: number;
  sort: number;
}

export interface Lesson {
  id: string;
  subject_id: string;
  kind: LessonKind;
  number: number;
  title: string;
  lesson_date: string | null;
  status: Status;
  colab_url: string | null;
  drive_url: string | null;
  created_by: string | null;
}

export interface LessonFile {
  id: string;
  lesson_id: string;
  kind: "pdf" | "code" | "data";
  name: string;
  storage_path: string;
  size_bytes: number | null;
}

export interface Question {
  id: string;
  subject_id: string;
  lesson_id: string | null;
  type: "mcq" | "written";
  difficulty: Difficulty;
  statement: string;
  options: string[] | null;
  correct_index: number | null;
  model_answer: string | null;
  explanation: string | null;
  status: Status;
}

export interface ScheduleSession {
  id: string;
  cohort_id: string;
  session_date: string;
  slot: number;
  subject_id: string;
  kind: SessionKind;
  room: string | null;
  teacher: string | null;
  shared_with: string | null;
  group_label: string | null;
  status: "scheduled" | "cancelled" | "changed";
  note: string | null;
}

export interface Announcement {
  id: string;
  cohort_id: string;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
}
