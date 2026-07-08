/**
 * Technical-layer guardrails for dynamic text-to-SQL (PRD §4). The read-only DB
 * account is the primary protection (verified at startup, see instrumentation.ts);
 * these add: a forced row cap, a statement timeout, and a table/column blacklist.
 *
 * Note: semantic correctness is deliberately out of scope (handled by showing the
 * SQL + saved-query reuse, not automated validation).
 */

function envInt(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export const MAX_ROWS = envInt("GUARDRAIL_MAX_ROWS", 1000);
export const STATEMENT_TIMEOUT_MS = envInt("GUARDRAIL_STATEMENT_TIMEOUT_MS", 5000);

// Reports run deliberate, human-authored SQL on the read-only replica, so they
// get a higher preview cap and a longer timeout than exploratory AI chat. The
// (larger) export path gets its own cap in a later slice (REPORT_EXPORT_MAX_ROWS).
export const REPORT_MAX_ROWS = envInt("REPORT_MAX_ROWS", 5000);
export const REPORT_STATEMENT_TIMEOUT_MS = envInt("REPORT_STATEMENT_TIMEOUT_MS", 15000);
// The export path runs a separate query with a much higher cap so a full data set
// can be downloaded — still capped to avoid OOM (a fully-unbounded export could
// stream, but that's a later concern).
export const REPORT_EXPORT_MAX_ROWS = envInt("REPORT_EXPORT_MAX_ROWS", 100000);

/** Reject any query that references these tables at all. Default: none. */
export const BLOCKED_TABLES = envList("GUARDRAIL_BLOCKED_TABLES", []);

/** Reject queries referencing these column names, and any result exposing them. */
export const BLOCKED_COLUMNS = envList("GUARDRAIL_BLOCKED_COLUMNS", [
  "password",
  "passwd",
  "pwd",
  "password_hash",
  "secret",
  "token",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "ssn",
  "credit_card",
  "card_number",
  "cvv",
]);

/**
 * A single read-only statement (SELECT / WITH, no multi-statement). Pure — no DB.
 * The read-only DB account is the real guarantee; this is a belt shared by the AI
 * engine, the Report runner, and Report-input validation.
 */
export function isReadOnly(sql: string): boolean {
  const s = sql.trim().replace(/;\s*$/, "");
  if (s.includes(";")) return false; // no multi-statement
  return /^(select|with)\b/i.test(s);
}

/** Raised when a query trips a guardrail. The message is user-facing. */
export class GuardrailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardrailError";
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(sql: string, term: string): boolean {
  return new RegExp(`\\b${escapeRegExp(term)}\\b`, "i").test(sql);
}

/**
 * Pre-execution check: reject before running if the SQL text references a
 * blocked table, or names a blocked column explicitly. (The SELECT * case is
 * caught after execution by checkBlockedResultColumns.)
 */
export function checkBlockedIdentifiers(sql: string): void {
  for (const t of BLOCKED_TABLES) {
    if (mentions(sql, t)) {
      throw new GuardrailError(`查詢涉及受限的資料表（${t}），已拒絕`);
    }
  }
  for (const c of BLOCKED_COLUMNS) {
    if (mentions(sql, c)) {
      throw new GuardrailError(`查詢涉及受限的敏感欄位（${c}），已拒絕`);
    }
  }
}

/** Post-execution check: catches blocked columns surfaced via SELECT *. */
export function checkBlockedResultColumns(columns: string[]): void {
  const blocked = new Set(BLOCKED_COLUMNS);
  const hit = columns.find((c) => blocked.has(c.toLowerCase()));
  if (hit) {
    throw new GuardrailError(`查詢結果包含受限的敏感欄位（${hit}），已拒絕`);
  }
}

/**
 * Force a row cap. Non-CTE queries are wrapped as a derived table so an inner
 * LIMIT can't exceed the cap. CTE queries (which can't be wrapped as a derived
 * table in MySQL) get a LIMIT appended when they don't already have one.
 */
export function enforceRowLimit(sql: string, max: number = MAX_ROWS): string {
  const s = sql.trim().replace(/;\s*$/, "");
  if (/^with\b/i.test(s)) {
    return /\blimit\b/i.test(s) ? s : `${s}\nLIMIT ${max}`;
  }
  return `SELECT * FROM (\n${s}\n) AS _guarded LIMIT ${max}`;
}

/** Best-effort detection of a statement-timeout error from mysql2. */
export function isTimeoutError(e: unknown): boolean {
  const err = e as { code?: string; errno?: number } | null;
  if (!err) return false;
  // MySQL ER_QUERY_TIMEOUT (3024), MariaDB ER_STATEMENT_TIMEOUT (1969),
  // or a mysql2 client-side timeout.
  return (
    err.errno === 3024 ||
    err.errno === 1969 ||
    err.code === "ER_QUERY_TIMEOUT" ||
    err.code === "ER_STATEMENT_TIMEOUT" ||
    err.code === "PROTOCOL_SEQUENCE_TIMEOUT" ||
    err.code === "ETIMEDOUT"
  );
}
