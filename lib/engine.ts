// NOTE: not `import "server-only"` — reused by ops scripts run via tsx (outside
// Next). Nothing in the client bundle imports this module (the UI imports types only).
import { ensureAnalyticsPool } from "./db";
import { getActiveProvider } from "./llm/factory";
import type { LLMProvider, SqlChartRequest, SqlChartResponse } from "./llm/provider";
import { resolveSchemaForQuestion, NoRelevantTablesError } from "./schema/retrieval";
import {
  checkBlockedIdentifiers,
  checkBlockedResultColumns,
  isReadOnly,
  isTimeoutError,
  GuardrailError,
} from "./guardrails";
import { executeGuarded } from "./analytics/execute";
import {
  normalizeQuestion,
  findExactSavedQuery,
  listSavedQuestions,
  getSavedQueryById,
  type SavedQueryHit,
} from "./state/savedQueries";
import { referencedFields, type EngineResult } from "./llm/types";

const MAX_ATTEMPTS = 2; // first try + one repair round

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}


/**
 * Trusted-query reuse (#3): find a confirmed saved query equivalent to this
 * question — exact normalized match first (cheap), then a conservative LLM
 * paraphrase match. Best-effort: any failure returns null → normal generation.
 */
async function findReusableQuery(
  question: string,
  userId: number,
  provider: LLMProvider,
): Promise<SavedQueryHit | null> {
  try {
    const exact = await findExactSavedQuery(userId, normalizeQuestion(question));
    if (exact) return exact;
    const candidates = await listSavedQuestions(userId);
    if (candidates.length === 0) return null;
    const id = await provider.matchSavedQuestion({ question, candidates });
    return id == null ? null : await getSavedQueryById(id, userId);
  } catch {
    return null;
  }
}

/**
 * Run a reused saved query under the same guardrails + column validation.
 * Returns null (→ fall through to normal generation) if it trips a guardrail,
 * errors, or its columns no longer satisfy the saved chart spec (stale schema).
 */
async function executeReused(hit: SavedQueryHit): Promise<EngineResult | null> {
  try {
    checkBlockedIdentifiers(hit.sql);
    const result = await executeGuarded(hit.sql);
    checkBlockedResultColumns(result.columns);
    const missing = referencedFields(hit.chartSpec).filter(
      (f) => !result.columns.includes(f),
    );
    if (missing.length > 0) return null;
    return {
      ok: true,
      sql: hit.sql,
      explanation: "重用了你已驗證過的查詢",
      chartSpec: hit.chartSpec,
      columns: result.columns,
      rows: result.rows,
      repaired: 0,
      fromSaved: true,
      tablesUsed: [],
    };
  } catch {
    return null;
  }
}

/**
 * The slice-02 engine (PRD §3): question -> {SQL, chart_spec} via structured
 * output -> run read-only -> validate the spec's referenced columns exist in
 * the result -> repair once if not -> return rows + spec for rendering.
 */
export interface RunEngineOptions {
  userId?: number;
  /** prior turns in the conversation (for follow-up context). */
  history?: { question: string; sql: string }[];
}

export async function runEngine(
  question: string,
  opts: RunEngineOptions = {},
): Promise<EngineResult> {
  const { userId, history = [] } = opts;

  // Provider + analytics pool are resolved from Settings (docs/adr/0005) and
  // rebuilt if a Super-Admin changed them — no restart needed.
  const { provider, missingKey } = await getActiveProvider();
  if (missingKey) {
    return { ok: false, error: missingKey };
  }
  if (!(await ensureAnalyticsPool())) {
    return { ok: false, error: "分析資料庫未設定（請在系統設定或 .env 填入連線）" };
  }

  // #3 trusted-query reuse: only for standalone questions (first turn). A
  // follow-up like "break Q3 into weeks" must go through generation with context,
  // not match a saved full-question.
  if (userId != null && history.length === 0) {
    const hit = await findReusableQuery(question, userId, provider);
    if (hit) {
      const reused = await executeReused(hit);
      if (reused) return reused;
    }
  }

  // Resolve the schema ONCE (two-stage retrieval) — it doesn't change between
  // repair attempts, and stage-1 selection is an extra LLM call we shouldn't repeat.
  let schema;
  try {
    schema = await resolveSchemaForQuestion(question, provider);
  } catch (e) {
    if (e instanceof NoRelevantTablesError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: `挑選資料表失敗：${errMsg(e)}` };
  }

  // Repair context for the next attempt; undefined on the first try.
  let repair: SqlChartRequest["repair"];
  let lastSql: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // 1. generate
    let gen: SqlChartResponse;
    try {
      gen = await provider.generateSqlAndChart({
        question,
        schemaDDL: schema.ddl,
        rules: schema.rules,
        relationships: schema.relationships,
        disconnectedPairs: schema.disconnectedPairs,
        history,
        repair,
      });
    } catch (e) {
      return { ok: false, error: `產生 SQL 失敗：${errMsg(e)}`, sql: lastSql };
    }
    lastSql = gen.sql;

    // 2. read-only guard
    if (!isReadOnly(gen.sql)) {
      return { ok: false, error: "只允許單一 SELECT 查詢", sql: gen.sql };
    }

    // 2b. blacklist (pre-execution): blocked tables / explicitly-named columns
    try {
      checkBlockedIdentifiers(gen.sql);
    } catch (e) {
      if (e instanceof GuardrailError) {
        return { ok: false, error: e.message, sql: gen.sql };
      }
      throw e;
    }

    // 3. execute under guardrails (forced LIMIT + statement timeout)
    let result: { rows: Record<string, unknown>[]; columns: string[] };
    try {
      result = await executeGuarded(gen.sql);
    } catch (e) {
      if (isTimeoutError(e)) {
        return {
          ok: false,
          error: "查詢逾時（可能掃描了過多資料），請縮小時間範圍或條件後再試",
          sql: gen.sql,
        };
      }
      return { ok: false, error: `查詢執行失敗：${errMsg(e)}`, sql: gen.sql };
    }

    // 3b. blacklist (post-execution): blocked columns surfaced via SELECT *
    try {
      checkBlockedResultColumns(result.columns);
    } catch (e) {
      if (e instanceof GuardrailError) {
        return { ok: false, error: e.message, sql: gen.sql };
      }
      throw e;
    }

    // 4. validate the chart spec against the actual result columns
    const missing = referencedFields(gen.chart_spec).filter(
      (f) => !result.columns.includes(f),
    );
    if (missing.length === 0) {
      return {
        ok: true,
        sql: gen.sql,
        explanation: gen.explanation,
        chartSpec: gen.chart_spec,
        columns: result.columns,
        rows: result.rows,
        repaired: attempt - 1,
        tablesUsed: schema.tables,
      };
    }

    // 5. set up a repair round
    repair = {
      previousSql: gen.sql,
      actualColumns: result.columns,
      missingFields: missing,
    };
  }

  return {
    ok: false,
    error: "AI 產生的圖表欄位與查詢結果對不上，修正後仍失敗",
    sql: lastSql,
  };
}
