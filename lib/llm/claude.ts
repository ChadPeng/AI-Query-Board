import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
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
} from "./prompts";

// NOTE: intentionally NOT `import "server-only"` — the bootstrap ops script
// (run via tsx, outside the Next server) reuses providers for describeTable.

const SqlChartSchema = z.object({
  sql: z.string(),
  chart_spec: z.object({
    chart_type: z.enum(["bar", "line", "area", "pie", "table"]),
    x: z.string(),
    y: z.array(z.string()),
    title: z.string(),
    aggregation: z.enum(["sum", "avg", "count", "min", "max", "none"]),
  }),
  explanation: z.string(),
});

const TableSelectionSchema = z.object({ tables: z.array(z.string()) });
const SavedMatchSchema = z.object({ match_id: z.number().int().nullable() });

const LearnSchema = z.object({
  relationships: z.array(
    z.object({
      fromTable: z.string(),
      fromColumn: z.string(),
      toTable: z.string(),
      toColumn: z.string(),
      cardinality: z.enum(["many_to_one", "one_to_one"]),
    }),
  ),
  rules: z.array(
    z.object({
      scope: z.enum(["global", "term", "table"]),
      termName: z.string().nullable(),
      table: z.string().nullable(),
      content: z.string(),
    }),
  ),
});

export class ClaudeProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;

  // opts come from Settings (docs/adr/0005); omitted → the SDK/env defaults apply,
  // which keeps the no-arg path working for ops scripts.
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : undefined);
    this.model = opts.model || process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  }

  async selectTables(req: TableSelectionRequest): Promise<string[]> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 512,
      thinking: { type: "disabled" },
      system: SELECT_SYSTEM,
      messages: [{ role: "user", content: buildSelectUserPrompt(req) }],
      output_config: { format: zodOutputFormat(TableSelectionSchema) },
    });
    if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此問題");
    return response.parsed_output?.tables ?? [];
  }

  async generateSqlAndChart(req: SqlChartRequest): Promise<SqlChartResponse> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      system: SQL_SYSTEM,
      messages: [{ role: "user", content: buildSqlUserPrompt(req) }],
      output_config: { format: zodOutputFormat(SqlChartSchema) },
    });
    if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此問題");
    const out = response.parsed_output;
    if (!out) throw new Error("模型未回傳符合格式的結果");
    return out;
  }

  async matchSavedQuestion(req: SavedQuestionMatchRequest): Promise<number | null> {
    if (req.candidates.length === 0) return null;
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 64,
      thinking: { type: "disabled" },
      system: SAVED_MATCH_SYSTEM,
      messages: [{ role: "user", content: buildSavedMatchUserPrompt(req) }],
      output_config: { format: zodOutputFormat(SavedMatchSchema) },
    });
    if (response.stop_reason === "refusal") return null;
    const id = response.parsed_output?.match_id ?? null;
    return id != null && req.candidates.some((c) => c.id === id) ? id : null;
  }

  async learnFromSql(req: LearnFromSqlRequest): Promise<LearnFromSqlResult> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 2048,
      thinking: { type: "disabled" },
      system: LEARN_SYSTEM,
      messages: [{ role: "user", content: buildLearnUserPrompt(req) }],
      output_config: { format: zodOutputFormat(LearnSchema) },
    });
    if (response.stop_reason === "refusal") throw new Error("模型拒絕回應此問題");
    return response.parsed_output ?? { relationships: [], rules: [] };
  }

  async describeTable(req: DescribeTableRequest): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 200,
      thinking: { type: "disabled" },
      system: DESCRIBE_SYSTEM,
      messages: [{ role: "user", content: buildDescribeUserPrompt(req) }],
    });
    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
    return text || `（${req.table}）`;
  }
}
