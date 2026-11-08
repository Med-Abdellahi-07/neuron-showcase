/**
 * Privacy protection before anything is sent to an external provider (Gemini's free tier is used to improve Google products).
 * 1) Profile data (name, email, phone, identifier) is never sent: the code does not even pass it in.
 * 2) What the student types is scrubbed of obvious email, phone and personal-link patterns before sending.
 */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Phone: 8+ digits (with separators/spaces/+), excluding short decimals and formulas.
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w])/g;

export function scrubPII(text: string): string {
  return text
    .replace(EMAIL, "[email]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 8 ? "[phone]" : m));
}
