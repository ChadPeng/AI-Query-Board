/** Shared helpers for LLM providers (Gemini, OpenAI-compatible: Groq/Ollama/…). */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Parse model output as JSON, tolerating ```json fences and stray prose
 * (smaller/local models sometimes wrap the object) by extracting the first
 * {...} block as a fallback.
 */
export function parseJsonLoose(s: string): unknown {
  let t = s.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]);
    throw new Error("模型未回傳有效的 JSON");
  }
}

/** Transient errors worth retrying: rate limits, server overload, network blips. */
export function isTransient(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e);
  return /\b429\b|\b50[023]\b|RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|rate.?limit|timeout|ETIMEDOUT|ECONNRESET|fetch failed/i.test(
    s,
  );
}
