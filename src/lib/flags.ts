/**
 * Multi-space switch. Default false: the platform runs a single space (IAA L2).
 * When false: no space choice at login, no /admin/spaces, no space switcher and no remaining L1 subjects.
 * The multi-space code stays in the repository (dormant) and is re-enabled with MULTI_SPACE_ENABLED=true.
 */
export const MULTI_SPACE = process.env.MULTI_SPACE_ENABLED === "true";

/** The only space's name when multi-space is off. */
export const SINGLE_SPACE_NAME = "IAA L2";
