const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_EMAIL_DOMAIN = "phone.neuron.local";

export interface ParsedIdentifier {
  email: string;
  phone: string | null;
  /** Last 8 digits, to match phones written in different formats at login. */
  phoneTail: string | null;
}

/**
 * Turns what the user types into a login email.
 * A phone number is only an identifier (no SMS): it is turned into an internal email <digits>@phone.neuron.local.
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
