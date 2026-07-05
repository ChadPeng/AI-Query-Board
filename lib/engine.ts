// NOTE: not `import "server-only"` — reused by ops scripts run via tsx (outside
// Next). Nothing in the client bundle imports this module (the UI imports types only).
import type { FieldPacket, RowDataPacket } from "mysql2/promise";
import { analyticsPool } from "./db";
import { createProvider, missingProviderKey } from "./llm/factory";
import type { LLMProvider, SqlChartRequest, SqlChartResponse } from "./llm/provider";
import { resolveSchemaForQuestion, NoRelevantTablesError } from "./schema/retrieval";
import {
  MAX_ROWS,
  STATEMENT_TIMEOUT_MS,
  checkBlockedIdentifiers,
  checkBlockedResultColumns,
  enforceRowLimit,
  isTimeoutError,
  GuardrailError,
} from "./guardrails";
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
 * Minimal slice-02 safety: only allow a single read-only statement. The full
 * guardrail stack (forced LIMIT, statement timeout, column blacklist) lands in
 * slice 04 — the read-only DB account is the real protection until then.
 */
function isReadOnly(sql: string): boolean {
  const s = sql.trim().replace(/;\s*$/, "");
  if (s.includes(";")) return false; // no multi-statement
  return /^(select|with)\b/i.test(s);
}

/**
 * Run a generated query under the technical guardrails (PRD §4):
 *   - statement timeout (server MAX_EXECUTION_TIME + client-side timeout)
 *   - forced row cap (LIMIT)
 * Read-only is already guaranteed by the DB account; isReadOnly() is a belt.
 */
async function executeGuarded(
  sql: string,
): Promise<{ rows: Record<string, unknown>[]; columns: string[] }> {
  const pool = analyticsPool();
  if (!pool) throw new Error("分析資料庫未設定（ANALYTICS_DB_* 環境變數）");
  const conn = await pool.getConnection();
  try {
    // Server-side kill switch for runaway scans. Dialect differs:
    //   MariaDB → SET SESSION max_statement_time = <seconds>
    //   MySQL   → SET SESSION MAX_EXECUTION_TIME = <milliseconds>
    // Try MariaDB first, fall back to MySQL; if neither is supported the
    // client-side query timeout below is the backstop.
    const seconds = Math.max(1, Math.ceil(STATEMENT_TIMEOUT_MS / 1000));
    try {
      await conn.query("SET SESSION max_statement_time = ?", [seconds]);
    } catch {
      try {
        await conn.query("SET SESSION MAX_EXECUTION_TIME = ?", [STATEMENT_TIMEOUT_MS]);
      } catch {
        /* neither variable supported — rely on the client-side timeout */
      }
    }
    const guarded = enforceRowLimit(sql, MAX_ROWS);
    const [rows, fields] = (await conn.query({
      sql: guarded,
      timeout: STATEMENT_TIMEOUT_MS + 2000, // client-side backstop
    })) as [RowDataPacket[], FieldPacket[]];
    const columns = (fields ?? []).map((f) => f.name);
    return { rows: rows as Record<string, unknown>[], columns };
  } finally {
    conn.release();
  }
}

let cachedProvider: LLMProvider | null = null;
function getProvider(): LLMProvider {
  cachedProvider ??= createProvider();
  return cachedProvider;
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

  const keyError = missingProviderKey();
  if (keyError) {
    return { ok: false, error: keyError };
  }
  if (!analyticsPool()) {
    return { ok: false, error: "分析資料庫未設定（請設定 ANALYTICS_DB_* 環境變數）" };
  }

  const provider = getProvider();

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
