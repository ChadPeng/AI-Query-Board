import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";
import { qualifiedName, parseQualified } from "../schema/introspect";

/**
 * The Semantic Layer's free-text rules (see docs/adr/0002). Global/shared, like
 * the table catalog. A rule's scope decides when it's injected into the pipeline:
 *   global — always; term — always (steers stage-1 table selection);
 *   table  — only when its table is among the selected ones (stage-2).
 */

export type RuleScope = "global" | "term" | "table";

export interface SemanticRule {
  id: number;
  scope: RuleScope;
  /** For scope='term': the business concept name (e.g. "創作者"). */
  termName: string | null;
  /** For scope='table': the bound table, schema-qualified via `table`. */
  table: string | null;
  content: string;
  reviewed: boolean;
}

export interface NewSemanticRule {
  scope: RuleScope;
  termName?: string | null;
  /** schema-qualified "schema.table"; only meaningful for scope='table'. */
  table?: string | null;
  content: string;
  reviewed?: boolean;
}

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

function rowToRule(r: RowDataPacket): SemanticRule {
  const schema = r.schema_name ? String(r.schema_name) : null;
  const table = r.table_name ? String(r.table_name) : null;
  return {
    id: Number(r.id),
    scope: String(r.scope) as RuleScope,
    termName: r.term_name != null ? String(r.term_name) : null,
    table: schema && table ? qualifiedName(schema, table) : null,
    content: String(r.content),
    reviewed: Boolean(r.reviewed),
  };
}

const SELECT_COLS =
  "id, scope, term_name, schema_name, table_name, content, reviewed";

/** Every rule, newest first — for the management UI. [] if the table is absent. */
export async function listRules(): Promise<SemanticRule[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT ${SELECT_COLS} FROM semantic_rule ORDER BY reviewed ASC, updated_at DESC`,
    )) as [RowDataPacket[], unknown];
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

/**
 * Rules injected at BOTH stages regardless of which tables are chosen: global
 * (cross-cutting) and term (named concepts that must steer table selection).
 */
export async function getAlwaysInjectedRules(): Promise<SemanticRule[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT ${SELECT_COLS} FROM semantic_rule
        WHERE scope IN ('global','term')
        ORDER BY scope, term_name`,
    )) as [RowDataPacket[], unknown];
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

/**
 * Table-scoped rules for the given schema-qualified tables — injected into
 * stage-2 only for tables stage-1 actually selected.
 */
export async function getTableRules(qualified: string[]): Promise<SemanticRule[]> {
  if (qualified.length === 0) return [];
  const pairs = qualified.map(parseQualified).filter((p): p is { schema: string; table: string } => p != null);
  if (pairs.length === 0) return [];
  const conds = pairs.map(() => "(schema_name = ? AND table_name = ?)").join(" OR ");
  const params = pairs.flatMap((p) => [p.schema, p.table]);
  try {
    const [rows] = (await pool().query(
      `SELECT ${SELECT_COLS} FROM semantic_rule
        WHERE scope = 'table' AND (${conds})
        ORDER BY schema_name, table_name`,
      params,
    )) as [RowDataPacket[], unknown];
    return rows.map(rowToRule);
  } catch {
    return [];
  }
}

/** Insert a rule; returns its new id. */
export async function createRule(r: NewSemanticRule): Promise<number> {
  const p = r.scope === "table" ? parseQualified(r.table ?? "") : null;
  const [res] = (await pool().query(
    `INSERT INTO semantic_rule (scope, term_name, schema_name, table_name, content, reviewed)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      r.scope,
      r.scope === "term" ? r.termName ?? null : null,
      p?.schema ?? null,
      p?.table ?? null,
      r.content,
      r.reviewed ? 1 : 0,
    ],
  )) as [ResultSetHeader, unknown];
  return res.insertId;
}

/** Update a rule's content/term/binding. Editing content resets reviewed via caller. */
export async function updateRule(id: number, r: NewSemanticRule): Promise<void> {
  const p = r.scope === "table" ? parseQualified(r.table ?? "") : null;
  await pool().query(
    `UPDATE semantic_rule
        SET scope = ?, term_name = ?, schema_name = ?, table_name = ?, content = ?, reviewed = ?
      WHERE id = ?`,
    [
      r.scope,
      r.scope === "term" ? r.termName ?? null : null,
      p?.schema ?? null,
      p?.table ?? null,
      r.content,
      r.reviewed ? 1 : 0,
      id,
    ],
  );
}

export async function setRuleReviewed(id: number, reviewed: boolean): Promise<void> {
  await pool().query("UPDATE semantic_rule SET reviewed = ? WHERE id = ?", [reviewed ? 1 : 0, id]);
}

export async function deleteRule(id: number): Promise<void> {
  await pool().query("DELETE FROM semantic_rule WHERE id = ?", [id]);
}
