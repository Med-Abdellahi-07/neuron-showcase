"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/auth";
import { getAllSubjects } from "@/lib/data";
import { addDays, isValidISO, isoWeekday, mondayOf } from "@/lib/dates";
import { generateJson } from "@/lib/ai";
import { flushAiStats } from "@/lib/ai/stats";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT_TIMES = "1=08:00-09:30, 2=09:30-11:00, 3=11:10-12:40, 4=12:40-14:10, 5=14:10-15:40, 6=15:40-17:10";

export interface DraftRow {
  date: string;
  slot: number;
  subject_id: string;
  kind: "cm" | "td" | "tp";
  room: string;
  teacher: string;
  group_label: string;
}

export type ExtractResponse = { ok: true; rows: DraftRow[]; skipped: number } | { ok: false; error: "busy" | "unavailable" | "invalid" };

/** يقرأ صورة جدول أسبوعي ويقترح حصصاً؛ لا يُحفظ شيء حتى يراجعها المشرف. */
export async function extractSchedule(input: { image: { mime: string; data: string }; week: string }): Promise<ExtractResponse> {
  await requireStaff();
  if (!["image/jpeg", "image/png", "image/webp"].includes(input.image.mime) || input.image.data.length > 6_000_000 || !isValidISO(input.week))
    return { ok: false, error: "invalid" };
  const monday = mondayOf(input.week);
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("ai_take", { p_kind: "schedule", p_window_limit: 5, p_window_seconds: 600, p_day_limit: 30 });
  if (allowed !== true) return { ok: false, error: "busy" };

  const subjects = await getAllSubjects();
  const list = subjects.map((s) => `${s.code}: ${s.name}`).join("\n");
  try {
    const { data } = await generateJson<{ sessions?: { day: number; slot: number; subject_code: string; kind: string; room?: string; teacher?: string; group?: string }[] }>({
      system: [
        "You read a photo of a weekly university timetable and extract sessions.",
        `Time slots: ${SLOT_TIMES}. Match each cell to a slot number by its time. Days: 1=Monday ... 6=Saturday.`,
        `Known subjects (use the exact code):\n${list}`,
        'Return ONLY JSON: {"sessions":[{"day":1-6,"slot":1-6,"subject_code":string,"kind":"cm"|"td"|"tp","room":string,"teacher":string,"group":string}]}. Use "" when unknown. Skip cells you cannot read; never guess a subject.',
      ].join("\n"),
      messages: [{ role: "user", text: "Extract the timetable.", images: [input.image] }],
      json: true,
      maxTokens: 3000,
      temperature: 0,
    });
    const byCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s.id]));
    let skipped = 0;
    const rows: DraftRow[] = [];
    for (const x of data.sessions ?? []) {
      const sid = byCode.get(String(x.subject_code ?? "").toUpperCase().replace(/\s+/g, ""));
      const day = Number(x.day), slot = Number(x.slot);
      const kind = String(x.kind ?? "").toLowerCase();
      if (!sid || !(day >= 1 && day <= 6) || !(slot >= 1 && slot <= 6) || !["cm", "td", "tp"].includes(kind)) {
        skipped++;
        continue;
      }
      rows.push({
        date: addDays(monday, day - 1),
        slot,
        subject_id: sid,
        kind: kind as DraftRow["kind"],
        room: String(x.room ?? "").slice(0, 40),
        teacher: String(x.teacher ?? "").slice(0, 80),
        group_label: String(x.group ?? "").slice(0, 40),
      });
    }
    return { ok: true, rows, skipped };
  } catch (e) {
    console.error("schedule extraction failed:", (e as Error).message);
    return { ok: false, error: "unavailable" };
  } finally {
    await flushAiStats(supabase);
  }
}

/** بعد المراجعة: حفظ الحصص (مع تجاهل المكرر). */
export async function saveExtracted(cohortId: string, rows: DraftRow[]): Promise<{ ok: boolean; saved: number }> {
  await requireStaff();
  if (!UUID_RE.test(cohortId) || !Array.isArray(rows) || rows.length > 80) return { ok: false, saved: 0 };
  const valid = rows.filter(
    (r) =>
      isValidISO(r.date) && isoWeekday(r.date) <= 6 && r.slot >= 1 && r.slot <= 6 && UUID_RE.test(r.subject_id) && ["cm", "td", "tp"].includes(r.kind)
  );
  if (!valid.length) return { ok: false, saved: 0 };
  const supabase = await createClient();
  const dates = valid.map((r) => r.date).sort();
  const { data: existing } = await supabase
    .from("schedule_sessions")
    .select("session_date, slot, subject_id, kind, group_label")
    .eq("cohort_id", cohortId)
    .gte("session_date", dates[0])
    .lte("session_date", dates[dates.length - 1]);
  const key = (d: string, s: number, sub: string, k: string, g: string | null) => `${d}|${s}|${sub}|${k}|${g ?? ""}`;
  const have = new Set((existing ?? []).map((e) => key(e.session_date as string, e.slot as number, e.subject_id as string, e.kind as string, e.group_label as string | null)));
  const insert = valid
    .filter((r) => !have.has(key(r.date, r.slot, r.subject_id, r.kind, r.group_label.trim() || null)))
    .map((r) => ({
      cohort_id: cohortId,
      session_date: r.date,
      slot: r.slot,
      subject_id: r.subject_id,
      kind: r.kind,
      room: r.room.trim() || null,
      teacher: r.teacher.trim() || null,
      group_label: r.group_label.trim() || null,
    }));
  if (insert.length) {
    const { error } = await supabase.from("schedule_sessions").insert(insert);
    if (error) return { ok: false, saved: 0 };
  }
  revalidatePath("/", "layout");
  return { ok: true, saved: insert.length };
}
