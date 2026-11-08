import { AiError, errorFromResponse } from "./errors";

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

/** Web search (Tavily). Sends only the question text, after scrubbing personal data. */
export async function tavilySearch(query: string, max = 4): Promise<WebResult[]> {
  const k = (process.env.TAVILY_API_KEY ?? "").trim().replace(/^["']|["']$/g, "");
  if (!k) throw new AiError("tavily", 0, "TAVILY_API_KEY غير مضبوط");
  let res: Response;
  try {
    res = await fetch((process.env.TAVILY_BASE_URL?.trim() || "https://api.tavily.com") + "/search", {
      method: "POST",
      headers: { authorization: `Bearer ${k}`, "content-type": "application/json" },
      body: JSON.stringify({ query: query.slice(0, 380), max_results: max, search_depth: "basic", include_answer: false }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new AiError("tavily", 0, `تعذّر الاتصال بـ Tavily: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw await errorFromResponse("tavily", res);
  const j = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
  return (j.results ?? [])
    .filter((r) => r.url && r.content)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, content: r.content!.slice(0, 700) }));
}
