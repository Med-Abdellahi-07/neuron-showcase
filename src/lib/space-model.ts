import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * A "space" = major x level (a row in the cohorts table). Its features (the plan) are separate flags changed by the super admin:
 *   ai          the smart assistant, analysis and everything that calls AI
 *   arena       ranked quiz       ranking  leaderboard       duel  Duel
 *   review      mistake review    recordings  recordings      qcm_pdf  QCM PDF download   chat  space chat
 *   written     written exercises
 * The real enforcement lives in the database (0018); here we hide the UI and refuse on the server before reaching it.
 */
export const FEATURES = ["ai", "arena", "ranking", "duel", "review", "recordings", "qcm_pdf", "written", "chat"] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureMap = Record<Feature, boolean>;
export type PlanCode = "full" | "basic" | "custom";

export interface LocalizedName {
  ar: string;
  fr: string;
  en: string;
}

export interface Space {
  id: string;
  /** Like "SDS L1". */
  name: string;
  plan: PlanCode;
  is_active: boolean;
  level_code: string | null;
  features: FeatureMap;
  major: { code: string; name: LocalizedName; institution: { code: string; name: LocalizedName } } | null;
}

/** Fills in missing keys with false (a missing key means disabled, as in the database). */
export function normalizeFeatures(raw: unknown): FeatureMap {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(FEATURES.map((f) => [f, src[f] === true])) as FeatureMap;
}

export const pickName = (n: LocalizedName | null | undefined, locale: Locale): string => (n ? n[locale] || n.fr || n.ar : "");

export interface SpaceRow {
  id: string;
  name: string;
  plan: PlanCode;
  is_active: boolean;
  level_code: string | null;
  features: unknown;
  majors: {
    code: string;
    name_ar: string;
    name_fr: string;
    name_en: string;
    institutions: { code: string; name_ar: string; name_fr: string; name_en: string } | null;
  } | null;
}

export const SPACE_SELECT =
  "id, name, plan, is_active, level_code, features, majors(code, name_ar, name_fr, name_en, institutions(code, name_ar, name_fr, name_en))";

export function toSpace(row: SpaceRow): Space {
  const m = row.majors;
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    is_active: row.is_active,
    level_code: row.level_code,
    features: normalizeFeatures(row.features),
    major: m
      ? {
          code: m.code,
          name: { ar: m.name_ar, fr: m.name_fr, en: m.name_en },
          institution: m.institutions
            ? { code: m.institutions.code, name: { ar: m.institutions.name_ar, fr: m.institutions.name_fr, en: m.institutions.name_en } }
            : { code: "", name: { ar: "", fr: "", en: "" } },
        }
      : null,
  };
}

/** Cookie with the space the user last chose on the login screen (space id). */
export const SPACE_COOKIE = "neuron-space";

/** Shape of the public space directory that public_directory() returns for the login screen (no private data). */
export interface DirectorySpace {
  id: string;
  level: string;
  open: boolean;
}
export interface DirectoryMajor {
  id: string;
  code: string;
  name: LocalizedName;
  spaces: DirectorySpace[];
}
export interface DirectoryInstitution {
  id: string;
  code: string;
  name: LocalizedName;
  majors: DirectoryMajor[];
}
export interface Directory {
  levels: string[];
  institutions: DirectoryInstitution[];
}
