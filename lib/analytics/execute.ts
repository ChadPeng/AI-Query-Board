// NOTE: not `import "server-only"` — reused by ops scripts run via tsx (outside
// Next). Nothing in the client bundle imports this module.
import type { FieldPacket, RowDataPacket } from "mysql2/promise";
import { ensureAnalyticsPool } from "../db";
import {
  MAX_ROWS,
  STATEMENT_TIMEOUT_MS,
  checkBlockedIdentifiers,
  checkBlockedResultColumns,
  enforceRowLimit,
  isReadOnly,
  GuardrailError,
} from "../guardrails";

export interface GuardedResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

/**
 * Run a query on the analytics (read-only) pool under the technical guardrails
 * (PRD §4): a statement timeout and a forced row cap. The caller picks the row
 * cap and timeout so the AI chat (small preview) and Reports (larger cap) can
 * differ. Read-only is already guaranteed by the DB account.
 */
export async function executeGuarded(
  sql: string,
  maxRows: number = MAX_ROWS,
  timeoutMs: number = STATEMENT_TIMEOUT_MS,
  /** positional bind values for `?` placeholders; when present the query runs as
   *  a prepared statement (conn.execute) so values are bound, never concatenated. */
  values?: unknown[],
): Promise<GuardedResult> {
  const pool = await ensureAnalyticsPool();
  if (!pool) throw new Error("分析資料庫未設定（請在系統設定或 .env 填入連線）");
  const conn = await pool.getConnection();
  try {
    // Server-side kill switch for runaway scans. Dialect differs:
    //   MariaDB → SET SESSION max_statement_time = <seconds>
    //   MySQL   → SET SESSION MAX_EXECUTION_TIME = <milliseconds>
    // Try MariaDB first, fall back to MySQL; if neither is supported the
    // client-side query timeout below is the backstop.
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    try {
      await conn.query("SET SESSION max_statement_time = ?", [seconds]);
    } catch {
      try {
        await conn.query("SET SESSION MAX_EXECUTION_TIME = ?", [timeoutMs]);
      } catch {
        /* neither variable supported — rely on the client-side timeout */
      }
    }
    const guarded = enforceRowLimit(sql, maxRows);
    const hasValues = Array.isArray(values) && values.length > 0;
    // client-side backstop timeout; when bound values are present, run as a
    // prepared statement (conn.execute) so values are bound, never concatenated.
    const opts = { sql: guarded, timeout: timeoutMs + 2000, values: hasValues ? values : undefined };
    const [rows, fields] = (
      hasValues ? await conn.execute(opts) : await conn.query(opts)
    ) as [RowDataPacket[], FieldPacket[]];
    const columns = (fields ?? []).map((f) => f.name);
    return { rows: rows as Record<string, unknown>[], columns };
  } finally {
    conn.release();
  }
}

/**
 * The full guarded path for a raw SQL string: read-only belt → pre-execution
 * blacklist → execute (timeout + forced row cap) → post-execution blacklist.
 * Throws GuardrailError on a rejected query. Used by the Report runner; the AI
 * engine composes the same primitives with its own repair loop instead.
 */
export async function runGuardedQuery(
  sql: string,
  opts: { maxRows?: number; timeoutMs?: number; values?: unknown[] } = {},
): Promise<GuardedResult> {
  if (!isReadOnly(sql)) throw new GuardrailError("只允許單一 SELECT 查詢");
  checkBlockedIdentifiers(sql);
  const result = await executeGuarded(sql, opts.maxRows, opts.timeoutMs, opts.values);
  checkBlockedResultColumns(result.columns);
  return result;
}
