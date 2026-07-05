import type { RowDataPacket } from "mysql2/promise";
import { statePool } from "../db";

export interface CatalogEntry {
  schema: string;
  table: string;
  description: string;
  reviewed: boolean;
}

/**
 * Read the full table catalog from the state DB. Returns [] if the catalog
 * table doesn't exist yet (bootstrap not run) so the engine can fall back to
 * the sample schema rather than erroring.
 */
export async function getCatalog(): Promise<CatalogEntry[]> {
  const pool = statePool();
  if (!pool) return [];
  try {
    const [rows] = (await pool.query(
      "SELECT schema_name, table_name, description, reviewed FROM table_catalog ORDER BY reviewed ASC, schema_name, table_name",
    )) as [RowDataPacket[], unknown];
    return rows.map((r) => ({
      schema: String(r.schema_name),
      table: String(r.table_name),
      description: String(r.description),
      reviewed: Boolean(r.reviewed),
    }));
  } catch {
    // Table doesn't exist yet (ER_NO_SUCH_TABLE) — treat as empty catalog.
    return [];
  }
}

/**
 * Insert or update a catalog entry. A human-reviewed description (reviewed=1)
 * is never clobbered by a re-bootstrap — only the AI-generated ones are
 * refreshed. This matches "AI 半自動建、人工只校對核心表".
 */
export async function upsertCatalogEntry(
  schema: string,
  table: string,
  description: string,
): Promise<void> {
  const pool = statePool();
  if (!pool) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  await pool.query(
    `INSERT INTO table_catalog (schema_name, table_name, description)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE
       description = IF(reviewed = 1, description, VALUES(description))`,
    [schema, table, description],
  );
}

/** Edit a catalog entry from the management UI (description and/or review state). */
export async function updateCatalogEntry(
  schema: string,
  table: string,
  description: string,
  reviewed: boolean,
): Promise<void> {
  const pool = statePool();
  if (!pool) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  await pool.query(
    "UPDATE table_catalog SET description = ?, reviewed = ? WHERE schema_name = ? AND table_name = ?",
    [description, reviewed ? 1 : 0, schema, table],
  );
}
