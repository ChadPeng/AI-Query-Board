import type { LLMProvider } from "./provider";
import { ClaudeProvider } from "./claude";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openaiCompat";

export type ProviderName = "claude" | "gemini" | "groq" | "ollama" | "openai-compat";

export function activeProviderName(): ProviderName {
  const p = process.env.LLM_PROVIDER;
  if (p === "gemini" || p === "groq" || p === "ollama" || p === "openai-compat") {
    return p;
  }
  return "claude";
}

/** Build the configured provider. Defaults to Claude; LLM_PROVIDER switches. */
export function createProvider(): LLMProvider {
  switch (activeProviderName()) {
    case "gemini":
      return new GeminiProvider();
    case "groq":
      return new OpenAICompatibleProvider({
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: process.env.GROQ_API_KEY || "",
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      });
    case "ollama":
      return new OpenAICompatibleProvider({
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1",
        apiKey: process.env.OLLAMA_API_KEY || "ollama", // Ollama ignores the key
        model: process.env.OLLAMA_MODEL || "qwen2.5-coder:7b",
      });
    case "openai-compat":
      return new OpenAICompatibleProvider({
        baseUrl: process.env.OPENAI_BASE_URL || "",
        apiKey: process.env.OPENAI_API_KEY || "",
        model: process.env.OPENAI_MODEL || "",
      });
    default:
      return new ClaudeProvider();
  }
}

/**
 * Returns a user-facing error if the active provider isn't configured, else null.
 * (Ollama needs no key — reachability surfaces at call time.)
 */
export function missingProviderKey(): string | null {
  switch (activeProviderName()) {
    case "gemini":
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
        ? null
        : "未設定 GEMINI_API_KEY（LLM_PROVIDER=gemini）";
    case "groq":
      return process.env.GROQ_API_KEY
        ? null
        : "未設定 GROQ_API_KEY（LLM_PROVIDER=groq，到 console.groq.com 拿免費 key）";
    case "ollama":
      return null; // no key; needs Ollama running locally
    case "openai-compat":
      return process.env.OPENAI_BASE_URL
        ? null
        : "未設定 OPENAI_BASE_URL（LLM_PROVIDER=openai-compat）";
    default:
      return process.env.ANTHROPIC_API_KEY ? null : "未設定 ANTHROPIC_API_KEY";
  }
}
