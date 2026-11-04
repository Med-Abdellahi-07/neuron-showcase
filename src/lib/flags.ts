/**
 * مفتاح تعدد الفضاءات. الافتراضي false: المنصة لفضاء واحد (IAA L2).
 * عند false: لا اختيار فضاء في الدخول، ولا /admin/spaces، ولا مبدّل فضاءات ولا مواد L1 المتبقية.
 * الشيفرة الخاصة بتعدد الفضاءات تبقى في المستودع (خاملة) لإعادة تفعيلها بـ MULTI_SPACE_ENABLED=true.
 */
export const MULTI_SPACE = process.env.MULTI_SPACE_ENABLED === "true";

/** اسم الفضاء الوحيد عند إيقاف التعدد */
export const SINGLE_SPACE_NAME = "IAA L2";
