import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * «الفضاء» = تخصص × مستوى (صف في جدول cohorts). ميزاته (الخطة) علامات منفصلة يغيّرها المشرف العام:
 *   ai          المساعد الذكي والتحليل وكل ما يستدعي الذكاء الاصطناعي
 *   arena       الاختبار المصنّف          ranking  الترتيب          duel  Duel
 *   review      مراجعة الأخطاء            recordings التسجيلات     qcm_pdf تنزيل QCM كملف PDF
 *   written     التمارين المكتوبة
 * الفرض الحقيقي في قاعدة البيانات (0018)؛ هنا نخفي الواجهة ونرفض في الخادم قبل الوصول إليها.
 */
export const FEATURES = ["ai", "arena", "ranking", "duel", "review", "recordings", "qcm_pdf", "written"] as const;
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
  /** مثل «SDS L1» */
  name: string;
  plan: PlanCode;
  is_active: boolean;
  level_code: string | null;
  features: FeatureMap;
  major: { code: string; name: LocalizedName; institution: { code: string; name: LocalizedName } } | null;
}

/** يُكمل المفاتيح الناقصة بـ false (مفتاح غير موجود = معطّل، كما في قاعدة البيانات) */
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

/** كوكي آخر فضاء اختاره المستخدم في شاشة الدخول (معرّف الفضاء) */
export const SPACE_COOKIE = "neuron-space";

/** شكل دليل الفضاءات العام الذي تعيده public_directory() لشاشة الدخول (بلا أي بيانات خاصة) */
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
