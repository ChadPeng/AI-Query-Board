import type { SettingType } from "./resolve";

/**
 * The catalog of runtime-editable Settings (docs/adr/0005). Each entry maps a
 * setting key to its `.env` fallback variable, type, built-in default, and UI
 * copy. This slice migrates one non-secret operational tunable end-to-end (the
 * report preview row cap); later slices append more (and secret settings).
 */
export interface SettingDef {
  key: string;
  envVar: string;
  type: SettingType;
  /** built-in default (a valid string for the type) */
  default: string;
  label: string;
  description: string;
  /** secret settings are encrypted at rest + write-only in the UI (slice 03) */
  secret?: boolean;
}

export const SETTINGS: SettingDef[] = [
  {
    key: "report.max_rows",
    envVar: "REPORT_MAX_ROWS",
    type: "number",
    default: "5000",
    label: "報表預覽列上限",
    description: "報表在畫面上預覽時最多回傳幾列（匯出走另一個較高的上限）。",
  },

  // --- Analytics DB connection (docs/adr/0005). The read-only DB text-to-SQL and
  // reports run against. Editable at runtime; the pool rebuilds on change. ---
  {
    key: "analytics.host",
    envVar: "ANALYTICS_DB_HOST",
    type: "string",
    default: "",
    label: "分析庫主機",
    description: "分析資料庫（唯讀，建議指向 replica）的主機位址。",
  },
  {
    key: "analytics.port",
    envVar: "ANALYTICS_DB_PORT",
    type: "number",
    default: "3306",
    label: "分析庫連接埠",
    description: "分析資料庫的連接埠。",
  },
  {
    key: "analytics.user",
    envVar: "ANALYTICS_DB_USER",
    type: "string",
    default: "",
    label: "分析庫帳號",
    description: "連線帳號（應為 SELECT-only）。",
  },
  {
    key: "analytics.password",
    envVar: "ANALYTICS_DB_PASSWORD",
    type: "string",
    default: "",
    label: "分析庫密碼",
    description: "連線密碼。加密存放，不回顯。",
    secret: true,
  },
  {
    key: "analytics.database",
    envVar: "ANALYTICS_DB_DATABASE",
    type: "string",
    default: "",
    label: "分析庫預設資料庫",
    description: "預設資料庫名稱（可留空，用 schema-qualified 名稱查詢）。",
  },
  {
    key: "analytics.schemas",
    envVar: "ANALYTICS_SCHEMAS",
    type: "list",
    default: "",
    label: "納入的 Schema",
    description: "目錄與檢索涵蓋的 schema（逗號分隔，留空＝只用預設資料庫）。",
  },

  // --- LLM provider (docs/adr/0005). Provider + the active provider's key/model
  // are runtime-editable; the provider rebuilds on change. Keys are secret. ---
  {
    key: "llm.provider",
    envVar: "LLM_PROVIDER",
    type: "string",
    default: "claude",
    label: "LLM 供應商",
    description: "claude / gemini / groq / ollama / openai-compat。",
  },
  { key: "llm.anthropic_key", envVar: "ANTHROPIC_API_KEY", type: "string", default: "", label: "Anthropic 金鑰", description: "LLM_PROVIDER=claude 時使用。", secret: true },
  { key: "llm.anthropic_model", envVar: "ANTHROPIC_MODEL", type: "string", default: "claude-sonnet-4-6", label: "Anthropic 模型", description: "" },
  { key: "llm.gemini_key", envVar: "GEMINI_API_KEY", type: "string", default: "", label: "Gemini 金鑰", description: "LLM_PROVIDER=gemini 時使用。", secret: true },
  { key: "llm.gemini_model", envVar: "GEMINI_MODEL", type: "string", default: "gemini-2.5-flash", label: "Gemini 模型", description: "" },
  { key: "llm.groq_key", envVar: "GROQ_API_KEY", type: "string", default: "", label: "Groq 金鑰", description: "LLM_PROVIDER=groq 時使用。", secret: true },
  { key: "llm.groq_model", envVar: "GROQ_MODEL", type: "string", default: "llama-3.3-70b-versatile", label: "Groq 模型", description: "" },
  { key: "llm.ollama_base_url", envVar: "OLLAMA_BASE_URL", type: "string", default: "http://localhost:11434/v1", label: "Ollama Base URL", description: "LLM_PROVIDER=ollama 時使用。" },
  { key: "llm.ollama_model", envVar: "OLLAMA_MODEL", type: "string", default: "qwen2.5-coder:7b", label: "Ollama 模型", description: "" },
  { key: "llm.openai_base_url", envVar: "OPENAI_BASE_URL", type: "string", default: "", label: "OpenAI 相容 Base URL", description: "LLM_PROVIDER=openai-compat 時使用。" },
  { key: "llm.openai_key", envVar: "OPENAI_API_KEY", type: "string", default: "", label: "OpenAI 相容 金鑰", description: "", secret: true },
  { key: "llm.openai_model", envVar: "OPENAI_MODEL", type: "string", default: "", label: "OpenAI 相容 模型", description: "" },
];

export function getSettingDef(key: string): SettingDef | undefined {
  return SETTINGS.find((s) => s.key === key);
}
