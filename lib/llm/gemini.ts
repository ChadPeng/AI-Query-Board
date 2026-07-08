import { GoogleGenAI } from "@google/genai";
import type {
  ChartSpec,
} from "./types";
import type {
  DescribeTableRequest,
  LearnFromSqlRequest,
  LearnFromSqlResult,
  LLMProvider,
  SavedQuestionMatchRequest,
  SqlChartRequest,
  SqlChartResponse,
  TableSelectionRequest,
} from "./provider";
import {
  SQL_SYSTEM,
  SELECT_SYSTEM,
  SAVED_MATCH_SYSTEM,
  DESCRIBE_SYSTEM,
  LEARN_SYSTEM,
  buildSqlUserPrompt,
  buildSelectUserPrompt,
  buildSavedMatchUserPrompt,
  buildDescribeUserPrompt,
  buildLearnUserPrompt,
  coerceLearnResult,
} from "./prompts";
import { sleep, parseJsonLoose, isTransient } from "./util";

// NOTE: not `server-only` — reused by the bootstrap ops script (tsx).

/**
 * Gemini adapter (Google AI Studio free tier). Uses JSON response mode + the
 * shared prompts; we validate/normalize the parsed object ourselves rather than
 * relying on a provider-specific response schema.
 */
export class GeminiProvider implements LLMProvider {
  private ai: GoogleGenAI;
  private model: string;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    this.ai = new GoogleGenAI({ apiKey });
    this.model = opts.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  /** One generateContent call with a short retry on transient (429/503) errors. */
  private async generate(
    system: string,
    user: string,
    json: boolean,
    retries = 5,
  ): Promise<string> {
    const config = json
      ? { systemInstruction: system, responseMimeType: "application/json", temperature: 0 }
      : { systemInstruction: system, temperature: 0 };
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await this.ai.models.generateContent({
          model: this.model,
          contents: user,
          config,
        });
        return response.text ?? "";
      } catch (e) {
        if (attempt >= retries || !isTransient(e)) throw e;
        // Ride out Google "high demand" 503 spikes: 2s,4s,6s,8s,10s (~30s total).
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  private async genJson<T>(system: string, user: string): Promise<T> {
    return parseJsonLoose(await this.generate(system, user, true)) as T;
  }

  private async genText(system: string, user: string): Promise<string> {
    return (await this.generate(system, user, false)).trim();
  }

  async selectTables(req: TableSelectionRequest): Promise<string[]> {
    const out = await this.genJson<{ tables?: unknown }>(
      SELECT_SYSTEM,
      buildSelectUserPrompt(req),
    );
    if (!Array.isArray(out.tables)) return [];
    return out.tables.filter((t): t is string => typeof t === "string");
  }

  async generateSqlAndChart(req: SqlChartRequest): Promise<SqlChartResponse> {
    const out = await this.genJson<{
      sql?: unknown;
      chart_spec?: ChartSpec;
      explanation?: unknown;
    }>(SQL_SYSTEM, buildSqlUserPrompt(req));

    if (typeof out.sql !== "string" || !out.chart_spec) {
      throw new Error("模型未回傳符合格式的結果");
    }
    return {
      sql: out.sql,
      chart_spec: out.chart_spec,
      explanation: typeof out.explanation === "string" ? out.explanation : "",
    };
  }

  async matchSavedQuestion(req: SavedQuestionMatchRequest): Promise<number | null> {
    if (req.candidates.length === 0) return null;
    try {
      const out = await this.genJson<{ match_id?: unknown }>(
        SAVED_MATCH_SYSTEM,
        buildSavedMatchUserPrompt(req),
      );
      const id = typeof out.match_id === "number" ? out.match_id : null;
      return id != null && req.candidates.some((c) => c.id === id) ? id : null;
    } catch {
      return null;
    }
  }

  async learnFromSql(req: LearnFromSqlRequest): Promise<LearnFromSqlResult> {
    const raw = await this.genJson<unknown>(LEARN_SYSTEM, buildLearnUserPrompt(req));
    return coerceLearnResult(raw);
  }

  async describeTable(req: DescribeTableRequest): Promise<string> {
    const text = await this.genText(DESCRIBE_SYSTEM, buildDescribeUserPrompt(req));
    return text || `（${req.table}）`;
  }
}
