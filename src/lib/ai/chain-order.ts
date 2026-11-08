export type LlmProvider = "groq" | "openrouter" | "nvidia" | "github" | "gemini";

/**
 * Provider order (decision in neuron-ai-plan.md). None of them train on students' personal requests, and Gemini is the last fallback.
 * Mistral is permanently excluded. Non-personal content (personal:false: periodic duel questions, question of the day) starts with Gemini.
 */
export const PERSONAL_CHAIN: LlmProvider[] = ["groq", "openrouter", "nvidia", "github", "gemini"];
export const GENERAL_CHAIN: LlmProvider[] = ["gemini", "groq", "openrouter", "nvidia", "github"];
