export type LlmProvider = "groq" | "openrouter" | "nvidia" | "github" | "gemini" | "mistral";

/**
 * ترتيب المزوّدين. كلهم لا يدرّبون على طلبات الطلاب الشخصية، وGemini احتياط أخير.
 * Mistral (Experiment) قد يدرّب على المدخلات فلا يُستعمل إلا للمحتوى غير الشخصي (personal:false)، وأولاً فيه لتوفير حصص الباقين.
 */
export const PERSONAL_CHAIN: LlmProvider[] = ["groq", "openrouter", "nvidia", "github", "gemini"];
export const GENERAL_CHAIN: LlmProvider[] = ["mistral", ...PERSONAL_CHAIN];

