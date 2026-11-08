"use server";
import { MULTI_SPACE } from "@/lib/flags";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireManager } from "@/lib/auth";
import type { Profile } from "@/lib/types";
import { getT } from "@/lib/i18n/server";
import { parseIdentifier } from "@/lib/identifier";
import { parseAccountRows, type AccountImportError } from "@/lib/account-import";
import type { FormState } from "./auth";

const text = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No ambiguous characters (0/O, 1/l/I) so passwords are easy to hand over to students. */
const PW_ALPHABET = "abcdefghjkmnpqrstuvwxyzACDEFGHJKLMNPQRTUVWXYZ2346789";
const genPassword = () => Array.from({ length: 10 }, () => PW_ALPHABET[randomInt(PW_ALPHABET.length)]).join("");

/** The space the admin works in. No space means no creation. The space always comes from the admin's profile, never from the input. */
function spaceOf(me: Profile): string | null {
  return me.cohort_id && UUID_RE.test(me.cohort_id) ? me.cohort_id : null;
}

type CreateResult = { ok: true; id: string } | { ok: false; exists: boolean };

async function createStudentAccount(cohortId: string, a: { full_name: string; email: string; phone: string | null; password: string }): Promise<CreateResult> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: a.email,
    password: a.password,
    email_confirm: true,
    user_metadata: { full_name: a.full_name },
  });
  if (error || !data.user) return { ok: false, exists: /already|registered|exists/i.test(error?.message ?? "") };
  const { error: pe } = await admin.from("profiles").insert({
    id: data.user.id,
    full_name: a.full_name.slice(0, 120),
    email: a.email,
    phone: a.phone,
    role: "student",
    cohort_id: cohortId,
    can_publish_direct: false,
  });
  if (pe) {
    await admin.auth.admin.deleteUser(data.user.id);
    return { ok: false, exists: pe.code === "23505" };
  }
  return { ok: true, id: data.user.id };
}

/** A single student in the admin's space. */
export async function createStudent(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireManager();
  const { t } = await getT();
  const cohort = spaceOf(me);
  const full_name = text(fd, "full_name");
  const parsed = parseIdentifier(text(fd, "identifier"));
  const password = String(fd.get("password") ?? "");
  if (!cohort || !full_name) return { error: t("common.error") };
  if (!parsed) return { error: t("acc.badIdentifier") };
  if (password.length < 8) return { error: t("reset.short") };
  const r = await createStudentAccount(cohort, { full_name, email: parsed.email, phone: parsed.phone, password });
  if (!r.ok) return { error: r.exists ? t("acc.exists") : t("common.error") };
  revalidatePath("/admin/students");
  return { message: t("acc.created") };
}

export interface BulkOutcome {
  created: { row: number; full_name: string; identifier: string; password: string }[];
  errors: (AccountImportError | { row: number; key: "acc.imp.err.exists" | "acc.imp.err.generic"; detail?: string })[];
  tooMany: boolean;
}

/** Bulk upload (rows from CSV/Excel). All accounts are students in the admin's space; an empty password is generated and returned once. */
export async function bulkCreateStudents(rows: string[][]): Promise<BulkOutcome> {
  const me = await requireManager();
  const cohort = spaceOf(me);
  const safe = Array.isArray(rows) ? rows.slice(0, 2000).map((r) => (Array.isArray(r) ? r.slice(0, 6).map((c) => String(c ?? "").slice(0, 200)) : [])) : [];
  const parsed = parseAccountRows(safe);
  const out: BulkOutcome = { created: [], errors: [...parsed.errors], tooMany: parsed.tooMany };
  if (!cohort) return out;
  for (const a of parsed.valid) {
    const password = a.password ?? genPassword();
    const r = await createStudentAccount(cohort, { full_name: a.full_name, email: a.email, phone: a.phone, password });
    if (r.ok) out.created.push({ row: a.row, full_name: a.full_name, identifier: a.phone ?? a.email, password });
    else out.errors.push({ row: a.row, key: r.exists ? "acc.imp.err.exists" : "acc.imp.err.generic", detail: a.phone ?? a.email });
  }
  revalidatePath("/admin/students");
  return out;
}

/** Verifies the target is a student in the admin's space (before any service-role mutation). */
async function ownStudent(me: Profile, id: string): Promise<boolean> {
  const cohort = spaceOf(me);
  if (!cohort || !UUID_RE.test(id)) return false;
  const { data } = await createAdminClient().from("profiles").select("role, cohort_id").eq("id", id).maybeSingle();
  return !!data && data.role === "student" && data.cohort_id === cohort;
}

export async function resetStudentPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const me = await requireManager();
  const { t } = await getT();
  const id = text(fd, "id");
  const password = String(fd.get("password") ?? "");
  if (password.length < 8) return { error: t("reset.short") };
  if (!(await ownStudent(me, id))) return { error: t("common.error") };
  const { error } = await createAdminClient().auth.admin.updateUserById(id, { password });
  if (error) return { error: t("common.error") };
  return { message: t("acc.updated") };
}

export async function deleteStudent(fd: FormData) {
  const me = await requireManager();
  const id = text(fd, "id");
  if (!(await ownStudent(me, id))) return;
  await createAdminClient().auth.admin.deleteUser(id);
  revalidatePath("/admin/students");
}

// Remaining L1 subjects.
// Inserts use the user's own client: RLS limits them to the admin of the student's space, and the database trigger
// rejects anything other than an L1 subject of the same major as the L2 student.

export async function addRemainingSubject(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireManager();
  const { t } = await getT();
  if (!MULTI_SPACE) return { error: t("common.error") };
  const student = text(fd, "student_id");
  const subject = text(fd, "subject_id");
  if (!UUID_RE.test(student) || !UUID_RE.test(subject)) return { error: t("common.error") };
  const supabase = await createClient();
  const { error } = await supabase.from("remaining_subjects").insert({ student_id: student, subject_id: subject });
  if (error) {
    if (error.code === "23505") return { error: t("rem.err.exists") };
    if (/subject_not_same_major_l1|student_not_l2|not_a_student|row-level security/.test(error.message)) return { error: t("rem.err.invalid") };
    console.error("addRemainingSubject failed:", error.code, error.message);
    return { error: t("common.error") };
  }
  revalidatePath("/", "layout");
  return { message: t("rem.added") };
}

export async function removeRemainingSubject(fd: FormData) {
  await requireManager();
  if (!MULTI_SPACE) return;
  const student = text(fd, "student_id");
  const subject = text(fd, "subject_id");
  if (!UUID_RE.test(student) || !UUID_RE.test(subject)) return;
  const supabase = await createClient();
  await supabase.from("remaining_subjects").delete().eq("student_id", student).eq("subject_id", subject);
  revalidatePath("/", "layout");
}
