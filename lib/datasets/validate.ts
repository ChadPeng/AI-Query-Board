import type { DatasetFieldDef, DatasetTableNode } from "./types";

/**
 * Star-schema invariants (docs/adr/0006), checked at save time AND re-asserted
 * by the compiler (defense in depth — a violated invariant must throw, never
 * silently produce wrong numbers).
 */

const ALIAS_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NAME_PATTERN = /^[^`\\]{1,120}$/;

export interface ValidatableModel {
  tables: DatasetTableNode[];
  fields: DatasetFieldDef[];
}

/** All violations found ([] = valid). Messages are user-facing (editor UI). */
export function validateDatasetModel(model: ValidatableModel): string[] {
  const errors: string[] = [];
  const { tables, fields } = model;

  if (tables.length === 0) {
    return ["模型至少要有一張基底表"];
  }

  // aliases: unique + SQL-safe
  const byAlias = new Map<string, DatasetTableNode>();
  for (const t of tables) {
    if (!ALIAS_PATTERN.test(t.alias)) errors.push(`別名「${t.alias}」不合法（限英數與底線）`);
    if (byAlias.has(t.alias)) errors.push(`別名「${t.alias}」重複`);
    byAlias.set(t.alias, t);
  }

  // exactly one base
  const bases = tables.filter((t) => t.parentAlias === null);
  if (bases.length !== 1) {
    errors.push(`模型必須恰有一張基底表（目前 ${bases.length} 張）`);
    return errors; // downstream checks need a single base
  }
  const base = bases[0];

  // every non-base node: complete join info, allowed cardinality, and its
  // parent chain reaches the base without a cycle
  for (const t of tables) {
    if (t.parentAlias === null) continue;
    if (!t.parentColumn || !t.childColumn) {
      errors.push(`「${t.alias}」缺少 JOIN 欄位（parent_column / child_column）`);
    }
    if (t.cardinality !== "many_to_one" && t.cardinality !== "one_to_one") {
      errors.push(`「${t.alias}」的基數必須是 many_to_one 或 one_to_one（星型限制）`);
    }
    if (!byAlias.has(t.parentAlias)) {
      errors.push(`「${t.alias}」的父節點「${t.parentAlias}」不存在`);
      continue;
    }
    // walk to base, cycle-guarded
    const seen = new Set<string>([t.alias]);
    let cur: DatasetTableNode | undefined = t;
    while (cur && cur.parentAlias !== null) {
      if (seen.has(cur.parentAlias)) {
        errors.push(`「${t.alias}」的父鏈成環`);
        break;
      }
      seen.add(cur.parentAlias);
      cur = byAlias.get(cur.parentAlias);
    }
    if (cur && cur.parentAlias === null && cur.alias !== base.alias) {
      errors.push(`「${t.alias}」的父鏈沒有到達基底表`);
    }
  }

  // fields
  const names = new Set<string>();
  for (const f of fields) {
    if (!NAME_PATTERN.test(f.name)) errors.push(`欄位名稱「${f.name}」不合法（不可含反引號）`);
    if (names.has(f.name)) errors.push(`欄位名稱「${f.name}」重複`);
    names.add(f.name);
    if (!byAlias.has(f.tableAlias)) {
      errors.push(`欄位「${f.name}」指向不存在的表別名「${f.tableAlias}」`);
      continue;
    }
    if (f.kind === "measure") {
      if (f.tableAlias !== base.alias) {
        errors.push(`度量「${f.name}」必須定義在基底表（星型限制，防 fan-out）`);
      }
      if (!f.aggregation) {
        errors.push(`度量「${f.name}」缺少聚合方式`);
      }
      if (f.aggregation !== "count" && !f.columnName) {
        errors.push(`度量「${f.name}」缺少欄位（只有 count 可以不指定欄位）`);
      }
      if (f.conditionSql != null && f.conditionSql.trim() !== "") {
        const cond = f.conditionSql;
        if (cond.includes(";")) errors.push(`度量「${f.name}」的條件不可含分號`);
        if (/[?]/.test(cond) || /:\w+/.test(cond)) {
          errors.push(`度量「${f.name}」的條件不可含佔位符（? 或 :name）`);
        }
      }
    } else {
      if (!f.columnName) errors.push(`維度「${f.name}」缺少欄位`);
      if (f.aggregation) errors.push(`維度「${f.name}」不可有聚合方式`);
      if (f.conditionSql) errors.push(`維度「${f.name}」不可有條件（口徑條件屬於度量）`);
    }
  }

  return errors;
}

/** The base table node (validate first — assumes exactly one exists). */
export function baseTable(tables: DatasetTableNode[]): DatasetTableNode {
  const base = tables.find((t) => t.parentAlias === null);
  if (!base) throw new Error("模型沒有基底表");
  return base;
}
