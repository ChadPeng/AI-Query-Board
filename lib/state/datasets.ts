import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { statePool } from "../db";
import type {
  DatasetFieldDef,
  DatasetInput,
  DatasetMeta,
  DatasetModel,
  DatasetTableNode,
} from "../datasets/types";

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

function rowToMeta(r: RowDataPacket): DatasetMeta {
  return {
    id: Number(r.id),
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    authorId: Number(r.author_id),
    published: Boolean(r.published),
  };
}

function rowToNode(r: RowDataPacket): DatasetTableNode {
  return {
    alias: String(r.alias),
    schema: String(r.schema_name),
    table: String(r.table_name),
    parentAlias: r.parent_alias != null ? String(r.parent_alias) : null,
    parentColumn: r.parent_column != null ? String(r.parent_column) : null,
    childColumn: r.child_column != null ? String(r.child_column) : null,
    cardinality: r.cardinality != null ? (String(r.cardinality) as DatasetTableNode["cardinality"]) : null,
    relationshipId: r.relationship_id != null ? Number(r.relationship_id) : null,
  };
}

function rowToField(r: RowDataPacket): DatasetFieldDef {
  return {
    id: Number(r.id),
    kind: String(r.kind) as DatasetFieldDef["kind"],
    name: String(r.name),
    description: r.description != null ? String(r.description) : null,
    tableAlias: String(r.table_alias),
    columnName: r.column_name != null ? String(r.column_name) : null,
    dataType: r.data_type != null ? String(r.data_type) : null,
    aggregation: r.aggregation != null ? (String(r.aggregation) as DatasetFieldDef["aggregation"]) : null,
    conditionSql: r.condition_sql != null ? String(r.condition_sql) : null,
    sortOrder: Number(r.sort_order),
  };
}

/** All datasets (editor view) or published only (viewer view). */
export async function listDatasets(publishedOnly: boolean): Promise<DatasetMeta[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT id, name, description, author_id, published FROM dataset` +
        (publishedOnly ? ` WHERE published = 1` : ``) +
        ` ORDER BY name`,
    )) as [RowDataPacket[], unknown];
    return rows.map(rowToMeta);
  } catch {
    return []; // table absent (migrations not run yet)
  }
}

export async function getDatasetModel(id: number): Promise<DatasetModel | null> {
  const [metaRows] = (await pool().query(
    `SELECT id, name, description, author_id, published FROM dataset WHERE id = ?`,
    [id],
  )) as [RowDataPacket[], unknown];
  if (!metaRows[0]) return null;
  const [tableRows] = (await pool().query(
    `SELECT alias, schema_name, table_name, parent_alias, parent_column, child_column,
            cardinality, relationship_id
       FROM dataset_table WHERE dataset_id = ? ORDER BY (parent_alias IS NULL) DESC, alias`,
    [id],
  )) as [RowDataPacket[], unknown];
  const [fieldRows] = (await pool().query(
    `SELECT id, kind, name, description, table_alias, column_name, data_type,
            aggregation, condition_sql, sort_order
       FROM dataset_field WHERE dataset_id = ? ORDER BY kind, sort_order, id`,
    [id],
  )) as [RowDataPacket[], unknown];
  return {
    ...rowToMeta(metaRows[0]),
    tables: tableRows.map(rowToNode),
    fields: fieldRows.map(rowToField),
  };
}

async function insertChildren(conn: PoolConnection, datasetId: number, input: DatasetInput) {
  for (const t of input.tables) {
    await conn.query(
      `INSERT INTO dataset_table
         (dataset_id, alias, schema_name, table_name, parent_alias, parent_column,
          child_column, cardinality, relationship_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datasetId, t.alias, t.schema, t.table, t.parentAlias, t.parentColumn,
        t.childColumn, t.cardinality, t.relationshipId,
      ],
    );
  }
  for (const [i, f] of input.fields.entries()) {
    await conn.query(
      `INSERT INTO dataset_field
         (dataset_id, kind, name, description, table_alias, column_name, data_type,
          aggregation, condition_sql, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        datasetId, f.kind, f.name, f.description, f.tableAlias, f.columnName,
        f.dataType, f.aggregation, f.conditionSql, f.sortOrder ?? i,
      ],
    );
  }
}

/** Create a dataset with its tables + fields in one transaction. Returns id. */
export async function createDataset(authorId: number, input: DatasetInput): Promise<number> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    const [res] = (await conn.query(
      `INSERT INTO dataset (name, description, author_id, published) VALUES (?, ?, ?, ?)`,
      [input.name, input.description, authorId, input.published ? 1 : 0],
    )) as [ResultSetHeader, unknown];
    await insertChildren(conn, res.insertId, input);
    await conn.commit();
    return res.insertId;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Replace-all update (v1): meta is updated, tables/fields deleted and
 * re-inserted in one transaction — simple and atomic; field ids change, which
 * is fine because ExplorerQuery is built fresh from the loaded model each time.
 */
export async function updateDataset(id: number, input: DatasetInput): Promise<void> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE dataset SET name = ?, description = ?, published = ? WHERE id = ?`,
      [input.name, input.description, input.published ? 1 : 0, id],
    );
    await conn.query(`DELETE FROM dataset_table WHERE dataset_id = ?`, [id]);
    await conn.query(`DELETE FROM dataset_field WHERE dataset_id = ?`, [id]);
    await insertChildren(conn, id, input);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function deleteDataset(id: number): Promise<void> {
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM dataset_field WHERE dataset_id = ?`, [id]);
    await conn.query(`DELETE FROM dataset_table WHERE dataset_id = ?`, [id]);
    await conn.query(`DELETE FROM dataset WHERE id = ?`, [id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
