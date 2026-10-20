import { parseIdentifier } from "./identifier.ts";

/** خطأ صف في استيراد الحسابات: مفتاح قاموس (يُترجم في الواجهة) + تفصيل اختياري */
export interface AccountImportError {
  row: number;
  key: "acc.imp.err.name" | "acc.imp.err.identifier" | "acc.imp.err.password" | "acc.imp.err.duplicate";
  detail?: string;
}
export interface AccountRow {
  row: number;
  full_name: string;
  email: string;
  phone: string | null;
  /** فارغ = يولَّد على الخادم */
  password: string | null;
}
export const MAX_ACCOUNT_ROWS = 300;
export const ACCOUNT_CSV_EXAMPLE = "full_name,identifier,password\nأحمد ولد محمد,22244556677,\nFatimata Sall,fatimata@example.com,Secret2026";

const ALIASES: Record<"name" | "id" | "pw", string[]> = {
  name: ["full_name", "fullname", "name", "nom", "الاسم", "اسم", "الاسم الكامل", "nom complet"],
  id: ["identifier", "email", "e-mail", "phone", "tel", "téléphone", "telephone", "mobile", "البريد", "الهاتف", "رقم الهاتف", "البريد الإلكتروني", "id"],
  pw: ["password", "pass", "mot de passe", "mdp", "كلمة السر", "كلمة المرور", "السر"],
};
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** يقبل مصفوفة صفوف (من CSV أو Excel). الصف الأول عنوان إن طابق أسماء الأعمدة المعروفة، وإلا الترتيب: الاسم، المعرّف، كلمة السر. */
export function parseAccountRows(rows: unknown[][]): { valid: AccountRow[]; errors: AccountImportError[]; tooMany: boolean } {
  const clean = rows.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
  let idx = { name: 0, id: 1, pw: 2 };
  let start = 0;
  if (clean.length) {
    const head = clean[0].map(norm);
    const find = (k: keyof typeof ALIASES) => head.findIndex((h) => ALIASES[k].includes(h));
    const n = find("name"), i = find("id"), p = find("pw");
    if (n >= 0 && i >= 0) {
      idx = { name: n, id: i, pw: p };
      start = 1;
    }
  }
  const body = clean.slice(start);
  const tooMany = body.length > MAX_ACCOUNT_ROWS;
  const valid: AccountRow[] = [];
  const errors: AccountImportError[] = [];
  const seen = new Set<string>();
  body.slice(0, MAX_ACCOUNT_ROWS).forEach((r, k) => {
    const row = k + 1;
    const full_name = String(r[idx.name] ?? "").trim().slice(0, 120);
    const rawId = String(r[idx.id] ?? "").trim();
    const pwRaw = idx.pw >= 0 ? String(r[idx.pw] ?? "").trim() : "";
    if (!full_name) return void errors.push({ row, key: "acc.imp.err.name" });
    const parsed = parseIdentifier(rawId);
    if (!parsed) return void errors.push({ row, key: "acc.imp.err.identifier", detail: rawId });
    if (pwRaw && pwRaw.length < 8) return void errors.push({ row, key: "acc.imp.err.password" });
    if (seen.has(parsed.email)) return void errors.push({ row, key: "acc.imp.err.duplicate", detail: rawId });
    seen.add(parsed.email);
    valid.push({ row, full_name, email: parsed.email, phone: parsed.phone, password: pwRaw || null });
  });
  return { valid, errors, tooMany };
}
