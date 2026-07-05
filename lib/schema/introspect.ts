import type { RowDataPacket } from "mysql2/promise";
import { analyticsPool } from "../db";

/**
 * Read-only, SCHEMA-AWARE introspection of the analytics server. The analytics
 * account may have access to several schemas (databases); the catalog/retrieval
 * can span the chosen subset, and table references are schema-qualified.
 */

function pool() {
  const p = analyticsPool();
  if (!p) throw new Error("分析資料庫未設定（ANALYTICS_DB_* 環境變數）");
  return p;
}

function ident(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

const SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
]);

/**
 * Which schemas the catalog/retrieval should cover. From ANALYTICS_SCHEMAS
 * (comma-separated); defaults to the single connected ANALYTICS_DB_DATABASE.
 */
export function getAnalyticsSchemas(): string[] {
  const raw = process.env.ANALYTICS_SCHEMAS;
  if (raw && raw.trim()) {
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
  const def = process.env.ANALYTICS_DB_DATABASE;
  return def ? [def] : [];
}

/** All non-system schemas the analytics account can see (for discovery). */
export async function listSchemas(): Promise<string[]> {
  const [rows] = (await pool().query(
    "SELECT SCHEMA_NAME AS s FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME",
  )) as [RowDataPacket[], unknown];
  return rows
    .map((r) => String(r.s))
    .filter((s) => !SYSTEM_SCHEMAS.has(s.toLowerCase()));
}

export interface SchemaTable {
  schema: string;
  table: string;
}

/** Base tables across the given schemas. */
export async function listTablesInSchemas(
  schemas: string[],
): Promise<SchemaTable[]> {
  if (schemas.length === 0) return [];
  const placeholders = schemas.map(() => "?").join(",");
  const [rows] = (await pool().query(
    `SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA IN (${placeholders}) AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_SCHEMA, TABLE_NAME`,
    schemas,
  )) as [RowDataPacket[], unknown];
  return rows.map((r) => ({ schema: String(r.s), table: String(r.t) }));
}

export interface ColumnInfo {
  schema: string;
  table: string;
  column: string;
  /** normalized type, e.g. "int", "varchar", "enum" */
  dataType: string;
  /** full column type, e.g. "enum('pending','paid','shipped')" */
  columnType: string;
  /** "PRI" for a primary-key column, "" otherwise */
  columnKey: string;
}

/** Columns of every base table in the given schemas — for relationship/rule inference. */
export async function listColumnsInSchemas(schemas: string[]): Promise<ColumnInfo[]> {
  if (schemas.length === 0) return [];
  const placeholders = schemas.map(() => "?").join(",");
  const [rows] = (await pool().query(
    `SELECT c.TABLE_SCHEMA AS s, c.TABLE_NAME AS t, c.COLUMN_NAME AS col,
            c.DATA_TYPE AS dt, c.COLUMN_TYPE AS ct, c.COLUMN_KEY AS ck
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES tb
         ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
      WHERE c.TABLE_SCHEMA IN (${placeholders}) AND tb.TABLE_TYPE = 'BASE TABLE'
      ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`,
    schemas,
  )) as [RowDataPacket[], unknown];
  return rows.map((r) => ({
    schema: String(r.s),
    table: String(r.t),
    column: String(r.col),
    dataType: String(r.dt),
    columnType: String(r.ct),
    columnKey: String(r.ck),
  }));
}

export async function getCreateTable(
  schema: string,
  table: string,
): Promise<string> {
  const [rows] = (await pool().query(
    `SHOW CREATE TABLE ${ident(schema)}.${ident(table)}`,
  )) as [RowDataPacket[], unknown];
  const row = rows[0] as Record<string, unknown> | undefined;
  const ddl = row?.["Create Table"] ?? row?.["Create View"];
  return typeof ddl === "string" ? ddl : "";
}

export async function sampleRows(
  schema: string,
  table: string,
  limit = 3,
): Promise<Record<string, unknown>[]> {
  const [rows] = (await pool().query(
    `SELECT * FROM ${ident(schema)}.${ident(table)} LIMIT ?`,
    [limit],
  )) as [RowDataPacket[], unknown];
  return rows as Record<string, unknown>[];
}

export function qualifiedName(schema: string, table: string): string {
  return `${schema}.${table}`;
}

export function parseQualified(
  q: string,
): { schema: string; table: string } | null {
  const i = q.indexOf(".");
  if (i <= 0 || i >= q.length - 1) return null;
  return { schema: q.slice(0, i), table: q.slice(i + 1) };
}

/**
 * DDL for the selected (schema-qualified) tables, each prefixed with a line
 * telling the model the exact schema-qualified name to use in SQL.
 */
export async function getCreateTablesFor(qualified: string[]): Promise<string> {
  const blocks = await Promise.all(
    qualified.map(async (q) => {
      const p = parseQualified(q);
      if (!p) return "";
      const ddl = await getCreateTable(p.schema, p.table);
      if (!ddl) return "";
      return `-- Reference this table in SQL as \`${p.schema}\`.\`${p.table}\`\n${ddl}`;
    }),
  );
  return blocks.filter(Boolean).join("\n\n");
}
