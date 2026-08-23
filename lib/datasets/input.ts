import type {
  DatasetFieldDef,
  DatasetInput,
  DatasetTableNode,
  ExplorerQuery,
  DateBucket,
  FilterOp,
} from "./types";
import { validateDatasetModel } from "./validate";

/**
 * Defensive body parsing for the dataset APIs (the lib/knowledgeInput.ts
 * pattern: return the parsed value, or a user-facing error string).
 */

const CARDS = new Set(["many_to_one", "one_to_one"]);
const KINDS = new Set(["dimension", "measure"]);
const AGGS = new Set(["sum", "avg", "count", "count_distinct", "min", "max"]);
const BUCKETS = new Set(["day", "week", "month", "quarter", "year"]);
const OPS = new Set(["eq", "neq", "in", "between", "gte", "lte", "contains"]);

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strOrNull = (v: unknown) => {
  const s = str(v);
  return s === "" ? null : s;
};

function parseTables(raw: unknown): DatasetTableNode[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "模型至少要有一張表";
  const out: DatasetTableNode[] = [];
  for (const item of raw) {
    const t = item as Record<string, unknown>;
    const node: DatasetTableNode = {
      alias: str(t.alias),
      schema: str(t.schema),
      table: str(t.table),
      parentAlias: strOrNull(t.parentAlias),
      parentColumn: strOrNull(t.parentColumn),
      childColumn: strOrNull(t.childColumn),
      cardinality: CARDS.has(String(t.cardinality))
        ? (String(t.cardinality) as DatasetTableNode["cardinality"])
        : null,
      relationshipId: typeof t.relationshipId === "number" ? t.relationshipId : null,
    };
    if (!node.alias || !node.schema || !node.table) return "表節點缺少 alias/schema/table";
    out.push(node);
  }
  return out;
}

/** 值標籤：僅維度、鍵值皆非空字串、最多 200 組（防止塞爆 prompt/畫面）。 */
function parseValueLabels(raw: unknown, kind: string): Record<string, string> | null | string {
  if (raw == null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "valueLabels 必須是物件";
  if (kind !== "dimension") return null; // 度量沒有值標籤，靜默丟棄
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.trim();
    const val = typeof v === "string" ? v.trim() : "";
    if (!key || !val) continue;
    if (key.length > 64 || val.length > 120) return "值標籤太長（值 64、標籤 120 字以內）";
    out[key] = val;
  }
  if (Object.keys(out).length > 200) return "值標籤最多 200 組";
  return Object.keys(out).length > 0 ? out : null;
}

function parseFields(raw: unknown): DatasetFieldDef[] | string {
  if (!Array.isArray(raw)) return "fields 必須是陣列";
  const out: DatasetFieldDef[] = [];
  for (const [i, item] of raw.entries()) {
    const f = item as Record<string, unknown>;
    const kind = String(f.kind);
    if (!KINDS.has(kind)) return `欄位 kind 不合法：${kind}`;
    const valueLabels = parseValueLabels(f.valueLabels, kind);
    if (typeof valueLabels === "string") return valueLabels;
    out.push({
      kind: kind as DatasetFieldDef["kind"],
      name: str(f.name),
      description: strOrNull(f.description),
      tableAlias: str(f.tableAlias),
      columnName: strOrNull(f.columnName),
      dataType: strOrNull(f.dataType),
      aggregation: AGGS.has(String(f.aggregation))
        ? (String(f.aggregation) as DatasetFieldDef["aggregation"])
        : null,
      conditionSql: strOrNull(f.conditionSql),
      valueLabels,
      sortOrder: typeof f.sortOrder === "number" ? f.sortOrder : i,
    });
  }
  return out;
}

/** Parse + structurally validate a create/update payload. */
export function parseDatasetInput(body: Record<string, unknown>): DatasetInput | string {
  const name = str(body.name);
  if (!name) return "請填模型名稱";
  if (name.length > 120) return "模型名稱過長（上限 120 字）";
  const tables = parseTables(body.tables);
  if (typeof tables === "string") return tables;
  const fields = parseFields(body.fields);
  if (typeof fields === "string") return fields;

  const violations = validateDatasetModel({ tables, fields });
  if (violations.length > 0) return violations.join("；");

  return {
    name,
    description: strOrNull(body.description),
    published: Boolean(body.published),
    tables,
    fields,
  };
}

/** Parse an Explorer run payload (field ids are validated by the compiler). */
export function parseExplorerQuery(body: Record<string, unknown>): ExplorerQuery | string {
  const q = (body.query ?? body) as Record<string, unknown>;
  const dimensions = Array.isArray(q.dimensions) ? q.dimensions : [];
  const measures = Array.isArray(q.measures) ? q.measures : [];
  const filters = Array.isArray(q.filters) ? q.filters : [];

  const dims: ExplorerQuery["dimensions"] = [];
  for (const d of dimensions) {
    const o = d as Record<string, unknown>;
    if (typeof o.fieldId !== "number") return "維度缺少 fieldId";
    const bucket = o.dateBucket != null ? String(o.dateBucket) : undefined;
    if (bucket && !BUCKETS.has(bucket)) return `不支援的日期粒度：${bucket}`;
    dims.push({ fieldId: o.fieldId, dateBucket: bucket as DateBucket | undefined });
  }
  const ms: ExplorerQuery["measures"] = [];
  for (const m of measures) {
    const o = m as Record<string, unknown>;
    if (typeof o.fieldId !== "number") return "度量缺少 fieldId";
    ms.push({ fieldId: o.fieldId });
  }
  const fs: ExplorerQuery["filters"] = [];
  for (const f of filters) {
    const o = f as Record<string, unknown>;
    if (typeof o.fieldId !== "number") return "篩選缺少 fieldId";
    const op = String(o.op);
    if (!OPS.has(op)) return `不支援的篩選運算：${op}`;
    const values = Array.isArray(o.values)
      ? o.values.filter((v): v is string | number => typeof v === "string" || typeof v === "number")
      : [];
    fs.push({ fieldId: o.fieldId, op: op as FilterOp, values });
  }

  let sort: ExplorerQuery["sort"];
  if (q.sort && typeof q.sort === "object") {
    const s = q.sort as Record<string, unknown>;
    const by = s.by === "dimension" ? ("dimension" as const) : typeof s.by === "number" ? s.by : null;
    if (by !== null) sort = { by, dir: s.dir === "desc" ? "desc" : "asc" };
  }

  return {
    dimensions: dims,
    measures: ms,
    filters: fs,
    sort,
    limit: typeof q.limit === "number" ? q.limit : undefined,
  };
}
