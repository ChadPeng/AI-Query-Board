// Server-only. Resolves the analytics-DB connection and the LLM provider config
// from Settings (which already merge DB override → .env → built-in default). The
// pool/provider layers use these + a signature to rebuild on change (hot reload).
import { getSetting } from "./service";
import type { ProviderName } from "../llm/factory";

async function str(key: string): Promise<string> {
  return String((await getSetting(key)).value);
}
async function numv(key: string): Promise<number> {
  const v = (await getSetting(key)).value;
  return typeof v === "number" ? v : Number(v);
}

export interface AnalyticsConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export async function resolveAnalyticsConfig(): Promise<AnalyticsConfig> {
  return {
    host: await str("analytics.host"),
    port: await numv("analytics.port"),
    user: await str("analytics.user"),
    password: await str("analytics.password"),
    database: await str("analytics.database"),
  };
}

export interface ProviderConfig {
  provider: ProviderName;
  anthropicKey: string;
  anthropicModel: string;
  geminiKey: string;
  geminiModel: string;
  groqKey: string;
  groqModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiBaseUrl: string;
  openaiKey: string;
  openaiModel: string;
}

export async function resolveProviderConfig(): Promise<ProviderConfig> {
  const p = await str("llm.provider");
  const provider = (["gemini", "groq", "ollama", "openai-compat"].includes(p) ? p : "claude") as ProviderName;
  return {
    provider,
    anthropicKey: await str("llm.anthropic_key"),
    anthropicModel: await str("llm.anthropic_model"),
    geminiKey: await str("llm.gemini_key"),
    geminiModel: await str("llm.gemini_model"),
    groqKey: await str("llm.groq_key"),
    groqModel: await str("llm.groq_model"),
    ollamaBaseUrl: await str("llm.ollama_base_url"),
    ollamaModel: await str("llm.ollama_model"),
    openaiBaseUrl: await str("llm.openai_base_url"),
    openaiKey: await str("llm.openai_key"),
    openaiModel: await str("llm.openai_model"),
  };
}
