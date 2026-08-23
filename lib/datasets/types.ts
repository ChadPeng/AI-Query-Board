/**
 * Dataset（資料模型，docs/adr/0006）shared types. No server imports — the
 * Explorer/ModelBuilder client components import these safely (the same
 * pattern as lib/llm/types.ts).
 *
 * Star-schema restriction (phase 1): exactly one base table; every join walks
 * many_to_one/one_to_one toward dimensions; measures live on the base table.
 * This structurally rules out fan-out, so the compiler is correct without
 * pre-aggregation subqueries.
 */

export type DatasetCardinality = "many_to_one" | "one_to_one";

/** A table node in the model. parentAlias === null ⇔ the base table. */
export interface DatasetTableNode {
  alias: string;
  schema: string;
  table: string;
  parentAlias: string | null;
  /** join column on the parent table */
  parentColumn: string | null;
  /** join column on THIS table */
  childColumn: string | null;
  /** parent→this direction; phase 1 allows only m:1 / 1:1 */
  cardinality: DatasetCardinality | null;
  /** provenance: the relationship edge this join was copied from (may dangle) */
  relationshipId: number | null;
}

export type FieldKind = "dimension" | "measure";
export type MeasureAggregation = "sum" | "avg" | "count" | "count_distinct" | "min" | "max";

export interface DatasetFieldDef {
  id?: number;
  kind: FieldKind;
  /** display name; doubles as the SQL result alias */
  name: string;
  description: string | null;
  tableAlias: string;
  /** null only for aggregation='count' (COUNT(*)) */
  columnName: string | null;
  /** cached MySQL data type (drives date buckets / filter widgets) */
  dataType: string | null;
  /** measures only */
  aggregation: MeasureAggregation | null;
  /** measures only: raw boolean SQL fragment (business口徑), editor-trusted */
  conditionSql: string | null;
  sortOrder: number;
}

export interface DatasetMeta {
  id: number;
  name: string;
  description: string | null;
  authorId: number;
  published: boolean;
}

export interface DatasetModel extends DatasetMeta {
  tables: DatasetTableNode[];
  fields: DatasetFieldDef[];
}

/** Create/update payload (id-less). */
export interface DatasetInput {
  name: string;
  description: string | null;
  published: boolean;
  tables: DatasetTableNode[];
  fields: DatasetFieldDef[];
}

export type DateBucket = "day" | "week" | "month" | "quarter" | "year";
export type FilterOp = "eq" | "neq" | "in" | "between" | "gte" | "lte" | "contains";

/** What the Explorer sends to run: field ids + transforms, never SQL. */
export interface ExplorerQuery {
  /** 至多兩個維度：第一個是 X 軸、第二個是顏色/系列（前端樞紐成多序列） */
  dimensions: { fieldId: number; dateBucket?: DateBucket }[];
  measures: { fieldId: number }[];
  /** phase 1: filters bind to dimension-kind fields only */
  filters: { fieldId: number; op: FilterOp; values: (string | number)[] }[];
  /** "dimension" or an index into `measures` */
  sort?: { by: "dimension" | number; dir: "asc" | "desc" };
  limit?: number;
}

export interface CompiledQuery {
  /** SELECT with ? placeholders */
  sql: string;
  /** bind values for the placeholders, in order */
  values: unknown[];
  columns: { key: string; label: string }[];
}

/** MySQL types the Explorer offers date buckets for. */
export const TEMPORAL_TYPES = new Set(["date", "datetime", "timestamp"]);
