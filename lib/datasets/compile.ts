import type {
  CompiledQuery,
  DatasetFieldDef,
  DatasetModel,
  DatasetTableNode,
  DateBucket,
  ExplorerQuery,
} from "./types";
import { baseTable, validateDatasetModel } from "./validate";

/**
 * Deterministic ExplorerQuery → MySQL SELECT compiler (docs/adr/0006). ZERO
 * LLM involvement — under the star-schema invariants (one base table, m:1/1:1
 * LEFT JOINs only, measures on the base) row count always equals the base
 * table's, so aggregates are correct without pre-aggregation.
 *
 * Injection posture: identifiers are backtick-escaped and come from the saved
 * model (editor-authored, validated); every FILTER VALUE binds through a `?`
 * placeholder. condition_sql is editor-trusted raw SQL — same trust level as
 * Report SQL (ADR-0004) — and still passes the full guardrail belt at run time.
 */

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

function ident(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

function columnExpr(alias: string, column: string): string {
  return `${ident(alias)}.${ident(column)}`;
}

function bucketExpr(expr: string, bucket: DateBucket): string {
  switch (bucket) {
    case "day":
      return `DATE(${expr})`;
    case "week":
      return `DATE_FORMAT(${expr}, '%x-W%v')`;
    case "month":
      return `DATE_FORMAT(${expr}, '%Y-%m')`;
    case "quarter":
      return `CONCAT(YEAR(${expr}), '-Q', QUARTER(${expr}))`;
    case "year":
      return `YEAR(${expr})`;
  }
}

/**
 * A measure's SQL expression. The condition wraps the aggregated value in
 * CASE WHEN (cond) THEN … END — implicit ELSE NULL is correct for every
 * aggregation we allow (SUM/AVG/MIN/MAX/COUNT all ignore NULLs).
 */
function measureExpr(f: DatasetFieldDef): string {
  const cond = f.conditionSql?.trim();
  if (f.aggregation === "count" && !f.columnName) {
    return cond ? `COUNT(CASE WHEN (${cond}) THEN 1 END)` : `COUNT(*)`;
  }
  const col = columnExpr(f.tableAlias, f.columnName!);
  const inner = cond ? `CASE WHEN (${cond}) THEN ${col} END` : col;
  switch (f.aggregation) {
    case "count_distinct":
      return `COUNT(DISTINCT ${inner})`;
    case "count":
      return `COUNT(${inner})`;
    default:
      return `${f.aggregation!.toUpperCase()}(${inner})`;
  }
}

/** Escape LIKE wildcards in a user-supplied contains value. */
function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** The aliases a query touches, expanded to include every parent up to base. */
function neededAliases(
  model: DatasetModel,
  usedAliases: Iterable<string>,
): Set<string> {
  const byAlias = new Map(model.tables.map((t) => [t.alias, t]));
  const needed = new Set<string>();
  for (const alias of usedAliases) {
    let cur = byAlias.get(alias);
    while (cur && !needed.has(cur.alias)) {
      needed.add(cur.alias);
      cur = cur.parentAlias ? byAlias.get(cur.parentAlias) : undefined;
    }
  }
  return needed;
}

/** JOIN clauses in tree order (parents before children), pruned to `needed`. */
function buildJoins(model: DatasetModel, needed: Set<string>): string[] {
  const clauses: string[] = [];
  const emitted = new Set<string>([baseTable(model.tables).alias]);
  // tree order: repeatedly emit nodes whose parent is already emitted
  let remaining = model.tables.filter((t) => t.parentAlias !== null && needed.has(t.alias));
  while (remaining.length > 0) {
    const ready = remaining.filter((t) => emitted.has(t.parentAlias!));
    if (ready.length === 0) throw new Error("JOIN 樹不連通（模型驗證應已擋下）");
    for (const t of ready) {
      clauses.push(
        `LEFT JOIN ${ident(t.schema)}.${ident(t.table)} AS ${ident(t.alias)}` +
          ` ON ${columnExpr(t.parentAlias!, t.parentColumn!)} = ${columnExpr(t.alias, t.childColumn!)}`,
      );
      emitted.add(t.alias);
    }
    remaining = remaining.filter((t) => !emitted.has(t.alias));
  }
  return clauses;
}

/**
 * Cheap save-time probes (no aggregation, LIMIT 1 — never a full scan):
 *   1. every referenced column exists across the full join tree;
 *   2. each measure condition parses and references real columns.
 * Run each through runGuardedQuery; a MySQL error = a validation message.
 */
export function compileProbeQueries(model: DatasetModel): { label: string; sql: string }[] {
  const violations = validateDatasetModel(model);
  if (violations.length > 0) {
    throw new Error(`模型不合法：${violations.join("；")}`);
  }
  const base = baseTable(model.tables);
  const all = neededAliases(model, model.tables.map((t) => t.alias));
  const from = [
    `FROM ${ident(base.schema)}.${ident(base.table)} AS ${ident(base.alias)}`,
    ...buildJoins(model, all),
  ].join("\n");

  const probes: { label: string; sql: string }[] = [];
  const cols = model.fields
    .filter((f) => f.columnName)
    .map((f) => `${columnExpr(f.tableAlias, f.columnName!)} AS ${ident(f.name)}`);
  if (cols.length > 0) {
    probes.push({ label: "欄位與 JOIN", sql: `SELECT ${cols.join(", ")}\n${from}\nLIMIT 1` });
  }
  for (const f of model.fields) {
    const cond = f.conditionSql?.trim();
    if (f.kind === "measure" && cond) {
      probes.push({
        label: `度量「${f.name}」的條件`,
        sql: `SELECT 1\n${from}\nWHERE (${cond})\nLIMIT 1`,
      });
    }
  }
  return probes;
}

export function compileExplorerQuery(model: DatasetModel, q: ExplorerQuery): CompiledQuery {
  // Defense in depth: never compile on top of a violated invariant.
  const violations = validateDatasetModel(model);
  if (violations.length > 0) {
    throw new Error(`模型不合法：${violations.join("；")}`);
  }
  if (q.dimensions.length > 2) throw new Error("最多支援兩個維度（X 軸＋顏色/系列）");
  if (q.dimensions.length === 0 && q.measures.length === 0) {
    throw new Error("至少要選一個維度或度量");
  }
  if (new Set(q.dimensions.map((d) => d.fieldId)).size !== q.dimensions.length) {
    throw new Error("兩個維度不能是同一個欄位");
  }

  const fieldById = new Map(model.fields.map((f) => [f.id!, f]));
  const getField = (id: number, want: "dimension" | "measure" | "any") => {
    const f = fieldById.get(id);
    if (!f) throw new Error(`欄位 ${id} 不存在於此模型`);
    if (want !== "any" && f.kind !== want) {
      throw new Error(`欄位「${f.name}」不是${want === "dimension" ? "維度" : "度量"}`);
    }
    return f;
  };

  const dims = q.dimensions.map((d) => ({ spec: d, field: getField(d.fieldId, "dimension") }));
  const measures = q.measures.map((m) => getField(m.fieldId, "measure"));
  const filters = q.filters.map((flt) => ({ ...flt, field: getField(flt.fieldId, "dimension") }));

  // JOIN pruning: only tables actually referenced (plus their parent chains).
  const base = baseTable(model.tables);
  const used = new Set<string>([base.alias]);
  for (const d of dims) used.add(d.field.tableAlias);
  for (const m of measures) used.add(m.tableAlias);
  for (const f of filters) used.add(f.field.tableAlias);
  const needed = neededAliases(model, used);

  // SELECT list
  const select: string[] = [];
  const columns: { key: string; label: string }[] = [];
  const dimExprs: string[] = [];
  for (const d of dims) {
    const raw = columnExpr(d.field.tableAlias, d.field.columnName!);
    const expr = d.spec.dateBucket ? bucketExpr(raw, d.spec.dateBucket) : raw;
    dimExprs.push(expr);
    select.push(`${expr} AS ${ident(d.field.name)}`);
    columns.push({ key: d.field.name, label: d.field.name });
  }
  for (const m of measures) {
    select.push(`${measureExpr(m)} AS ${ident(m.name)}`);
    columns.push({ key: m.name, label: m.name });
  }

  // WHERE — every value binds via ?
  const where: string[] = [];
  const values: unknown[] = [];
  for (const { field, op, values: vs } of filters) {
    const expr = columnExpr(field.tableAlias, field.columnName!);
    switch (op) {
      case "eq":
        if (vs.length !== 1) throw new Error(`篩選「${field.name}」需要 1 個值`);
        where.push(`${expr} = ?`);
        values.push(vs[0]);
        break;
      case "neq":
        if (vs.length !== 1) throw new Error(`篩選「${field.name}」需要 1 個值`);
        where.push(`${expr} <> ?`);
        values.push(vs[0]);
        break;
      case "gte":
        if (vs.length !== 1) throw new Error(`篩選「${field.name}」需要 1 個值`);
        where.push(`${expr} >= ?`);
        values.push(vs[0]);
        break;
      case "lte":
        if (vs.length !== 1) throw new Error(`篩選「${field.name}」需要 1 個值`);
        where.push(`${expr} <= ?`);
        values.push(vs[0]);
        break;
      case "between":
        if (vs.length !== 2) throw new Error(`篩選「${field.name}」需要 2 個值`);
        where.push(`${expr} BETWEEN ? AND ?`);
        values.push(vs[0], vs[1]);
        break;
      case "in":
        if (vs.length === 0) throw new Error(`篩選「${field.name}」至少需要 1 個值`);
        where.push(`${expr} IN (${vs.map(() => "?").join(", ")})`);
        values.push(...vs);
        break;
      case "contains":
        if (vs.length !== 1) throw new Error(`篩選「${field.name}」需要 1 個值`);
        where.push(`${expr} LIKE ?`);
        values.push(`%${escapeLike(String(vs[0]))}%`);
        break;
      default:
        throw new Error(`不支援的篩選運算：${op}`);
    }
  }

  // assemble
  const lines: string[] = [];
  const distinct = dims.length > 0 && measures.length === 0 ? "DISTINCT " : "";
  lines.push(`SELECT ${distinct}${select.join(", ")}`);
  lines.push(`FROM ${ident(base.schema)}.${ident(base.table)} AS ${ident(base.alias)}`);
  lines.push(...buildJoins(model, needed));
  if (where.length > 0) lines.push(`WHERE ${where.join(" AND ")}`);
  if (dims.length > 0 && measures.length > 0) lines.push(`GROUP BY ${dimExprs.join(", ")}`);

  // ORDER BY: explicit sort > dimensions ASC (time series read naturally).
  // "dimension" sorts by the FIRST dimension (the X axis); the second (colour/
  // series) always tags along ASC so pivoted series come out in stable order.
  if (q.sort) {
    if (q.sort.by === "dimension") {
      if (dims.length === 0) throw new Error("沒有維度可排序");
      const rest = dimExprs.slice(1).map((e) => `${e} ASC`);
      lines.push(`ORDER BY ${[`${dimExprs[0]} ${q.sort.dir === "desc" ? "DESC" : "ASC"}`, ...rest].join(", ")}`);
    } else {
      const m = measures[q.sort.by];
      if (!m) throw new Error("排序指到不存在的度量");
      lines.push(`ORDER BY ${ident(m.name)} ${q.sort.dir === "desc" ? "DESC" : "ASC"}`);
    }
  } else if (dims.length > 0) {
    lines.push(`ORDER BY ${dimExprs.map((e) => `${e} ASC`).join(", ")}`);
  }

  const limit = Math.max(1, Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  lines.push(`LIMIT ${limit}`);

  return { sql: lines.join("\n"), values, columns };
}
