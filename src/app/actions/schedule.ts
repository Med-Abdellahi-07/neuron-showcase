"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireManager, requireStaff } from "@/lib/auth";
import { getT } from "@/lib/i18n/server";
import { notifyScheduleChange } from "@/lib/notify";
import { addDays, isValidISO, isoWeekday, mondayOf } from "@/lib/dates";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const optional = (fd: FormData, k: string) => text(fd, k) || null;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function addSession(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireStaff();
  const { t } = await getT();
  const date = text(fd, "session_date");
  const slot = parseInt(text(fd, "slot"), 10);
  const kind = text(fd, "kind");
  const cohort_id = me.cohort_id ?? ""; // The user's space, not what is in the form.
  const subject_id = text(fd, "subject_id");
  if (
    !isValidISO(date) ||
    isoWeekday(date) > 6 ||
    !(slot >= 1 && slot <= 6) ||
    !["cm", "td", "tp"].includes(kind) ||
    !UUID_RE.test(cohort_id) ||
    !UUID_RE.test(subject_id)
  )
    return { error: t("common.error") };

  const supabase = await createClient();
  const { error } = await supabase.from("schedule_sessions").insert({
    cohort_id,
    session_date: date,
    slot,
    subject_id,
    kind,
    room: optional(fd, "room"),
    teacher: optional(fd, "teacher"),
    shared_with: optional(fd, "shared_with"),
    group_label: optional(fd, "group_label"),
  });
  if (error) return { error: t("common.error") };
  revalidatePath("/", "layout");
  return { message: t("common.saved") };
}

export async function setSessionStatus(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  const status = text(fd, "status");
  if (!UUID_RE.test(id) || !["scheduled", "cancelled", "changed"].includes(status)) return;
  const supabase = await createClient();
  const { data } = await supabase
    .from("schedule_sessions")
    .update({ status, note: optional(fd, "note") })
    .eq("id", id)
    .select("cohort_id, subject_id, kind, session_date, group_label, status, note")
    .maybeSingle();
  // Cancelling or changing an upcoming session (past sessions do not notify).
  if (data && (data.status === "cancelled" || data.status === "changed") && data.session_date >= new Date().toISOString().slice(0, 10))
    await notifyScheduleChange(data);
  revalidatePath("/", "layout");
}

export async function deleteSession(fd: FormData) {
  await requireStaff();
  const id = text(fd, "id");
  if (!UUID_RE.test(id)) return;
  const supabase = await createClient();
  await supabase.from("schedule_sessions").delete().eq("id", id);
  revalidatePath("/", "layout");
}

/** Copies the previous week's sessions into the chosen week (skips duplicates and resets status to scheduled). */
export async function copyPreviousWeek(fd: FormData) {
  const me = await requireStaff();
  const cohort_id = me.cohort_id ?? "";
  const week = text(fd, "week");
  if (!UUID_RE.test(cohort_id) || !isValidISO(week)) return;
  const monday = mondayOf(week);
  const prev = addDays(monday, -7);

  const supabase = await createClient();
  const [{ data: source }, { data: existing }] = await Promise.all([
    supabase.from("schedule_sessions").select("*").eq("cohort_id", cohort_id).gte("session_date", prev).lte("session_date", addDays(prev, 6)),
    supabase.from("schedule_sessions").select("session_date, slot, subject_id, kind, group_label").eq("cohort_id", cohort_id).gte("session_date", monday).lte("session_date", addDays(monday, 6)),
  ]);
  const key = (d: string, s: number, sub: string, k: string, g: string | null) => `${d}|${s}|${sub}|${k}|${g ?? ""}`;
  const have = new Set((existing ?? []).map((e) => key(e.session_date as string, e.slot as number, e.subject_id as string, e.kind as string, e.group_label as string | null)));

  const rows = (source ?? [])
    .map((s) => ({
      cohort_id,
      session_date: addDays(s.session_date as string, 7),
      slot: s.slot,
      subject_id: s.subject_id,
      kind: s.kind,
      room: s.room,
      teacher: s.teacher,
      shared_with: s.shared_with,
      group_label: s.group_label,
    }))
    .filter((r) => !have.has(key(r.session_date, r.slot as number, r.subject_id as string, r.kind as string, r.group_label as string | null)));
  if (rows.length) await supabase.from("schedule_sessions").insert(rows);
  revalidatePath("/", "layout");
}

/** Admin only: semester start date (used for week numbering). Empty means no numbering. */
export async function setSemesterStart(fd: FormData) {
  await requireManager();
  const id = text(fd, "semester_id");
  const raw = text(fd, "start_date");
  if (!UUID_RE.test(id) || (raw !== "" && !isValidISO(raw))) return;
  const supabase = await createClient();
  await supabase.from("semesters").update({ start_date: raw || null }).eq("id", id);
  revalidatePath("/", "layout");
}
