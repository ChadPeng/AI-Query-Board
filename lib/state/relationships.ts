import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";

/**
 * Relationships: human-authored join edges the DDL doesn't declare (see
 * docs/adr/0001). One uniform directed edge from_col -> to_col plus a
 * cardinality; the reverse is derived, never stored. Many-to-many is not a
 * stored type — it emerges when the relationship graph is walked across a
 * junction table (see lib/schema/relationshipGraph.ts). Global/shared.
 */

export type Cardinality = "many_to_one" | "one_to_one";

export interface Relationship {
  id: number;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
  cardinality: Cardinality;
  reviewed: boolean;
}

export type NewRelationship = Omit<Relationship, "id" | "reviewed"> & {
  reviewed?: boolean;
};

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

const SELECT_COLS =
  "id, from_schema, from_table, from_column, to_schema, to_table, to_column, cardinality, reviewed";

function rowToRel(r: RowDataPacket): Relationship {
  return {
    id: Number(r.id),
    fromSchema: String(r.from_schema),
    fromTable: String(r.from_table),
    fromColumn: String(r.from_column),
    toSchema: String(r.to_schema),
    toTable: String(r.to_table),
    toColumn: String(r.to_column),
    cardinality: String(r.cardinality) as Cardinality,
    reviewed: Boolean(r.reviewed),
  };
}

/** Every edge — for the graph and the management UI. [] if the table is absent. */
export async function listRelationships(): Promise<Relationship[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT ${SELECT_COLS} FROM relationship ORDER BY reviewed ASC, from_schema, from_table`,
    )) as [RowDataPacket[], unknown];
    return rows.map(rowToRel);
  } catch {
    return [];
  }
}

/**
 * The already-stored edge that is the REVERSE of the given one (same two
 * columns, opposite direction), if any. Callers warn on this — the DB unique key
 * can't catch it because the column order differs. Returns null on any error.
 */
export async function findReverseEdge(r: NewRelationship): Promise<Relationship | null> {
  try {
    const [rows] = (await pool().query(
      `SELECT ${SELECT_COLS} FROM relationship
        WHERE from_schema = ? AND from_table = ? AND from_column = ?
          AND to_schema = ? AND to_table = ? AND to_column = ?
        LIMIT 1`,
      [r.toSchema, r.toTable, r.toColumn, r.fromSchema, r.fromTable, r.fromColumn],
    )) as [RowDataPacket[], unknown];
    return rows[0] ? rowToRel(rows[0]) : null;
  } catch {
    return null;
  }
}

/** Insert (or update an identical edge). Returns the row id. */
export async function createRelationship(r: NewRelationship): Promise<number> {
  const [res] = (await pool().query(
    `INSERT INTO relationship
       (from_schema, from_table, from_column, to_schema, to_table, to_column, cardinality, reviewed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       cardinality = IF(reviewed = 1, cardinality, VALUES(cardinality)),
       reviewed = GREATEST(reviewed, VALUES(reviewed)),
       id = LAST_INSERT_ID(id)`,
    [
      r.fromSchema, r.fromTable, r.fromColumn,
      r.toSchema, r.toTable, r.toColumn,
      r.cardinality, r.reviewed ? 1 : 0,
    ],
  )) as [ResultSetHeader, unknown];
  return res.insertId;
}

export async function updateRelationship(id: number, r: NewRelationship): Promise<void> {
  await pool().query(
    `UPDATE relationship
        SET from_schema = ?, from_table = ?, from_column = ?,
            to_schema = ?, to_table = ?, to_column = ?,
            cardinality = ?, reviewed = ?
      WHERE id = ?`,
    [
      r.fromSchema, r.fromTable, r.fromColumn,
      r.toSchema, r.toTable, r.toColumn,
      r.cardinality, r.reviewed ? 1 : 0, id,
    ],
  );
}

export async function setRelationshipReviewed(id: number, reviewed: boolean): Promise<void> {
  await pool().query("UPDATE relationship SET reviewed = ? WHERE id = ?", [reviewed ? 1 : 0, id]);
}

export async function deleteRelationship(id: number): Promise<void> {
  await pool().query("DELETE FROM relationship WHERE id = ?", [id]);
}
