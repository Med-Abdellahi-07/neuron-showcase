import { useId } from "react";

/** Unique id safe to use inside url(#...) in SVG (strips the colons from useId). */
export function useUid(prefix = "g"): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}
