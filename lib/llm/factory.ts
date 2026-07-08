import type { LLMProvider } from "./provider";
import { ClaudeProvider } from "./claude";
import { GeminiProvider } from "./gemini";
import { OpenAICompatibleProvider } from "./openaiCompat";
import type { ProviderConfig } from "../settings/config";
import { resolveProviderConfig } from "../settings/config";

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

/** Build a provider from a resolved Settings config (docs/adr/0005). */
export function createProviderFromConfig(cfg: ProviderConfig): LLMProvider {
  switch (cfg.provider) {
    case "gemini":
      return new GeminiProvider({ apiKey: cfg.geminiKey, model: cfg.geminiModel });
    case "groq":
      return new OpenAICompatibleProvider({
        baseUrl: "https://api.groq.com/openai/v1",
        apiKey: cfg.groqKey,
        model: cfg.groqModel || "llama-3.3-70b-versatile",
      });
    case "ollama":
      return new OpenAICompatibleProvider({
        baseUrl: cfg.ollamaBaseUrl || "http://localhost:11434/v1",
        apiKey: "ollama",
        model: cfg.ollamaModel || "qwen2.5-coder:7b",
      });
    case "openai-compat":
      return new OpenAICompatibleProvider({
        baseUrl: cfg.openaiBaseUrl,
        apiKey: cfg.openaiKey,
        model: cfg.openaiModel,
      });
    default:
      return new ClaudeProvider({ apiKey: cfg.anthropicKey, model: cfg.anthropicModel });
  }
}

/** A user-facing error if `cfg`'s active provider lacks its key, else null. */
export function missingProviderKeyForConfig(cfg: ProviderConfig): string | null {
  switch (cfg.provider) {
    case "gemini":
      return cfg.geminiKey ? null : "未設定 Gemini 金鑰（LLM 供應商=gemini）";
    case "groq":
      return cfg.groqKey ? null : "未設定 Groq 金鑰（LLM 供應商=groq）";
    case "ollama":
      return null;
    case "openai-compat":
      return cfg.openaiBaseUrl ? null : "未設定 OpenAI 相容 Base URL";
    default:
      return cfg.anthropicKey ? null : "未設定 Anthropic 金鑰";
  }
}

// Cache the active provider; rebuild only when the resolved config changes so a
// Super-Admin can switch provider/key/model at runtime without a restart.
let activeProvider: { sig: string; provider: LLMProvider } | null = null;

export async function getActiveProvider(): Promise<{ provider: LLMProvider; missingKey: string | null }> {
  const cfg = await resolveProviderConfig();
  const sig = JSON.stringify(cfg);
  if (!activeProvider || activeProvider.sig !== sig) {
    activeProvider = { sig, provider: createProviderFromConfig(cfg) };
  }
  return { provider: activeProvider.provider, missingKey: missingProviderKeyForConfig(cfg) };
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
