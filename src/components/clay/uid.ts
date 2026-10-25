import { useId } from "react";

/** معرّف فريد آمن للاستخدام داخل url(#…) في SVG (يزيل النقطتين من useId). */
export function useUid(prefix = "g"): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}
