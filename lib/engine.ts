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
  isRetryableSqlError,
  isTimeoutError,
  GuardrailError,
} from "./guardrails";
import { supplementDdlForSqlError } from "./schema/repairSupplement";
import { executeGuarded } from "./analytics/execute";
import {
  normalizeQuestion,
  findExactSavedQuery,
  listSavedQuestions,
  listSavedQueryExamples,
  getSavedQueryById,
  type SavedQueryHit,
} from "./state/savedQueries";
import { pickFewShotExamples, type FewShotExample } from "./fewshot";
import { tryResolveDatasetSchema } from "./schema/datasetSchema";
import { recordQueryFailure } from "./state/queryFailures";
import { referencedFields, type EngineFailure, type EngineResult } from "./llm/types";

// First try + up to two repair rounds. Chart-mismatch and SQL-error repairs
// share the same budget, bounding worst-case latency (each retry is one more
// LLM call).
const MAX_ATTEMPTS = 3;

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
 * output -> run read-only -> validate + self-repair (MySQL execution errors
 * and chart/result mismatches both feed back into regeneration, sharing the
 * MAX_ATTEMPTS budget) -> return rows + spec for rendering.
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

  // Failure telemetry (第二波，選配): every failed answer is a curation lead.
  // recordQueryFailure never throws; awaiting keeps it alive on serverless.
  const fail = async (
    stage: string,
    error: string,
    sql?: string,
    errno?: number,
  ): Promise<EngineFailure> => {
    await recordQueryFailure({ userId, question, stage, sql, errno, errorMsg: error });
    return { ok: false, error, sql };
  };

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

  // Resolve the schema ONCE — it doesn't change between repair attempts.
  // Dataset-first (BI 第四波): a curated Dataset match skips stage-1 selection
  // and graph-connect entirely; a miss falls through to two-stage retrieval.
  let schema;
  try {
    schema =
      (await tryResolveDatasetSchema(question, provider)) ??
      (await resolveSchemaForQuestion(question, provider));
  } catch (e) {
    if (e instanceof NoRelevantTablesError) {
      return fail("retrieval", e.message);
    }
    return fail("retrieval", `挑選資料表失敗：${errMsg(e)}`);
  }

  // Few-shot (第二波): confirmed same-table question→SQL pairs as demonstrations.
  let examples: FewShotExample[] = [];
  if (userId != null) {
    try {
      examples = pickFewShotExamples(
        question,
        schema.tables,
        await listSavedQueryExamples(userId),
      );
    } catch {
      /* best-effort — generation proceeds without examples */
    }
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
        joinPaths: schema.joinPaths,
        disconnected: schema.disconnected,
        history,
        examples: examples.length > 0 ? examples : undefined,
        repair,
      });
    } catch (e) {
      return fail("generate", `產生 SQL 失敗：${errMsg(e)}`, lastSql);
    }
    lastSql = gen.sql;

    // 2. read-only guard
    if (!isReadOnly(gen.sql)) {
      return fail("readonly", "只允許單一 SELECT 查詢", gen.sql);
    }

    // 2b. blacklist (pre-execution): blocked tables / explicitly-named columns
    try {
      checkBlockedIdentifiers(gen.sql);
    } catch (e) {
      if (e instanceof GuardrailError) {
        return fail("guardrail", e.message, gen.sql);
      }
      throw e;
    }

    // 3. execute under guardrails (forced LIMIT + statement timeout)
    let result: { rows: Record<string, unknown>[]; columns: string[] };
    try {
      result = await executeGuarded(gen.sql);
    } catch (e) {
      if (isTimeoutError(e)) {
        return fail(
          "timeout",
          "查詢逾時（可能掃描了過多資料），請縮小時間範圍或條件後再試",
          gen.sql,
        );
      }
      // Self-repair: feed the MySQL error back to the model (whitelisted
      // "the model wrote wrong SQL" errors only). For unknown column/table,
      // deterministically look up the table that has it and add its DDL.
      if (attempt < MAX_ATTEMPTS && isRetryableSqlError(e)) {
        // Leave a trace of the repair round (stats split repair_* from real
        // failures) — a recovered query still tells us what the model got wrong.
        await recordQueryFailure({
          userId,
          question,
          stage: "repair_sql",
          sql: gen.sql,
          errno: (e as { errno?: number } | null)?.errno,
          errorMsg: errMsg(e),
        });
        repair = {
          kind: "sql_error",
          previousSql: gen.sql,
          errorMessage: errMsg(e),
          addedDdl: await supplementDdlForSqlError(e, schema.tables),
        };
        continue;
      }
      const errno = (e as { errno?: number } | null)?.errno;
      return fail("execute", `查詢執行失敗：${errMsg(e)}`, gen.sql, errno);
    }

    // 3b. blacklist (post-execution): blocked columns surfaced via SELECT *
    try {
      checkBlockedResultColumns(result.columns);
    } catch (e) {
      if (e instanceof GuardrailError) {
        return fail("guardrail", e.message, gen.sql);
      }
      throw e;
    }

    // 4. validate the chart spec against the actual result columns
    const missing = referencedFields(gen.chart_spec).filter(
      (f) => !result.columns.includes(f),
    );
    if (missing.length === 0) {
      // Surface knowledge gaps: tables the graph couldn't connect mean the
      // model had to guess the join — nudge the human curation loop.
      const warnings =
        schema.disconnected.length > 0
          ? [
              `知識庫中沒有連接這些表的關係：${schema.disconnected
                .map(({ pair: [a, b] }) => `${a} ↔ ${b}`)
                .join("、")}。若結果不對，到「語意層」補上關係可提高準確度。`,
            ]
          : undefined;
      return {
        ok: true,
        sql: gen.sql,
        explanation: gen.explanation,
        chartSpec: gen.chart_spec,
        columns: result.columns,
        rows: result.rows,
        repaired: attempt - 1,
        tablesUsed: schema.tables,
        datasetUsed: schema.datasetName,
        warnings,
      };
    }

    // 5. set up a repair round
    await recordQueryFailure({
      userId,
      question,
      stage: "repair_chart",
      sql: gen.sql,
      errorMsg: `chart_spec 引用了結果中不存在的欄位：${missing.join(", ")}`,
    });
    repair = {
      kind: "chart_mismatch",
      previousSql: gen.sql,
      actualColumns: result.columns,
      missingFields: missing,
    };
  }

  return fail("chart_repair", "AI 產生的圖表欄位與查詢結果對不上，修正後仍失敗", lastSql);
}
