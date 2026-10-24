export type LlmProvider = "groq" | "openrouter" | "nvidia" | "github" | "gemini";

/**
 * ترتيب المزوّدين (قرار neuron-ai-plan.md). كلهم لا يدرّبون على طلبات الطلاب الشخصية، وGemini آخر احتياط.
 * Mistral مستبعد نهائياً. المحتوى غير الشخصي (personal:false: أسئلة Duel الدورية، سؤال اليوم) يبدأ بـ Gemini.
 */
export const PERSONAL_CHAIN: LlmProvider[] = ["groq", "openrouter", "nvidia", "github", "gemini"];
export const GENERAL_CHAIN: LlmProvider[] = ["gemini", "groq", "openrouter", "nvidia", "github"];
