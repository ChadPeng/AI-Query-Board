import type { ChartSpec } from "./types";
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

export interface OpenAICompatConfig {
  baseUrl: string; // e.g. https://api.groq.com/openai/v1  or  http://localhost:11434/v1
  apiKey: string; // any non-empty string for Ollama
  model: string;
}

/**
 * One adapter for any OpenAI-compatible /chat/completions endpoint — covers Groq
 * (free cloud), Ollama (local, free/unlimited), OpenRouter, etc. JSON methods use
 * response_format json_object; lenient parsing tolerates models that add prose.
 */
export class OpenAICompatibleProvider implements LLMProvider {
  constructor(private cfg: OpenAICompatConfig) {}

  private async chat(
    system: string,
    user: string,
    json: boolean,
    retries = 5,
  ): Promise<string> {
    const url = this.cfg.baseUrl.replace(/\/$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    };
    if (json) body.response_format = { type: "json_object" };

    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.cfg.apiKey || "none"}`,
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`${res.status} ${text.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        return data.choices?.[0]?.message?.content ?? "";
      } catch (e) {
        if (attempt >= retries || !isTransient(e)) throw e;
        await sleep(2000 * (attempt + 1)); // 2s,4s,6s,8s,10s
      }
    }
  }

  async selectTables(req: TableSelectionRequest): Promise<string[]> {
    const out = parseJsonLoose(
      await this.chat(SELECT_SYSTEM, buildSelectUserPrompt(req), true),
    ) as { tables?: unknown };
    return Array.isArray(out.tables)
      ? out.tables.filter((t): t is string => typeof t === "string")
      : [];
  }

  async generateSqlAndChart(req: SqlChartRequest): Promise<SqlChartResponse> {
    const out = parseJsonLoose(
      await this.chat(SQL_SYSTEM, buildSqlUserPrompt(req), true),
    ) as { sql?: unknown; chart_spec?: ChartSpec; explanation?: unknown };
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
      const out = parseJsonLoose(
        await this.chat(SAVED_MATCH_SYSTEM, buildSavedMatchUserPrompt(req), true),
      ) as { match_id?: unknown };
      const id = typeof out.match_id === "number" ? out.match_id : null;
      return id != null && req.candidates.some((c) => c.id === id) ? id : null;
    } catch {
      return null;
    }
  }

  async learnFromSql(req: LearnFromSqlRequest): Promise<LearnFromSqlResult> {
    const raw = parseJsonLoose(
      await this.chat(LEARN_SYSTEM, buildLearnUserPrompt(req), true),
    );
    return coerceLearnResult(raw);
  }

  async describeTable(req: DescribeTableRequest): Promise<string> {
    const text = (await this.chat(DESCRIBE_SYSTEM, buildDescribeUserPrompt(req), false)).trim();
    return text || `（${req.table}）`;
  }
}
