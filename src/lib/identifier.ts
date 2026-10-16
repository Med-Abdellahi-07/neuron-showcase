const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_EMAIL_DOMAIN = "phone.neuron.local";

export interface ParsedIdentifier {
  email: string;
  phone: string | null;
  /** آخر 8 أرقام، لمطابقة الهاتف بصيغ مختلفة عند الدخول */
  phoneTail: string | null;
}

/**
 * يحوّل ما يكتبه المستخدم إلى بريد دخول.
 * الهاتف معرّف فقط (بلا SMS): نحوّله إلى بريد داخلي <digits>@phone.neuron.local.
 */
export function parseIdentifier(raw: string): ParsedIdentifier | null {
  const v = raw.trim();
  if (!v) return null;
  if (v.includes("@")) {
    return EMAIL_RE.test(v) ? { email: v.toLowerCase(), phone: null, phoneTail: null } : null;
  }
  const digits = v.replace(/[\s\-().]/g, "").replace(/^\+/, "").replace(/^00/, "");
  if (!/^\d{6,15}$/.test(digits)) return null;
  return { email: `${digits}@${PHONE_EMAIL_DOMAIN}`, phone: digits, phoneTail: digits.slice(-8) };
}
