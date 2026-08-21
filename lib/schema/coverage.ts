import type { CatalogEntry } from "../state/catalog";
import type { Relationship } from "../state/relationships";
import type { SemanticRule, RuleScope } from "../state/semanticRules";
import type { ColumnInfo } from "./introspect";
import { qualifiedName } from "./introspect";

/**
 * Knowledge-base health check (JOIN 可靠性計畫切片 1): how much of the analytics
 * schema the Semantic Layer actually covers. The numbers drive the human
 * curation loop — isolated tables and FK-looking columns without an edge are
 * exactly where graph-connect fails and the model is left guessing JOINs.
 */

export interface FkGap {
  /** schema-qualified table */
  table: string;
  column: string;
  dataType: string;
}

export interface CoverageStats {
  catalog: {
    total: number;
    reviewed: number;
    excluded: number;
    /** entries with a non-empty description */
    described: number;
    schemas: string[];
  };
  relationships: {
    total: number;
    reviewed: number;
    /** active (non-excluded) catalog tables that appear in ≥1 edge */
    tablesWithEdges: number;
  };
  graph: {
    /** connected components among active tables that have edges */
    componentCount: number;
    largestComponent: number;
    /** active catalog tables with no edge at all (sorted) */
    isolatedTables: string[];
  };
  /** FK-looking columns (xxx_id / xxx_uid / uid / xxx_no) on active tables that
   * are not a PK and have no outgoing relationship edge — the discovery worklist. */
  fkGaps: FkGap[];
  rules: { scope: RuleScope; total: number; reviewed: number }[];
  /** false when the analytics DB was unreachable → fkGaps is empty, not "clean" */
  analyticsAvailable: boolean;
}

const FK_NAME_PATTERN = /(_id|_uid|_no)$|^uid$/i;

/** Pure computation — everything IO'd by the caller. */
export function computeCoverage(
  catalog: CatalogEntry[],
  relationships: Relationship[],
  rules: SemanticRule[],
  columns: ColumnInfo[],
  analyticsAvailable: boolean,
): CoverageStats {
  const active = catalog.filter((c) => !c.excluded);
  const activeSet = new Set(active.map((c) => qualifiedName(c.schema, c.table)));

  // Which tables touch any edge (either side, even if the other side is
  // outside the catalog — the table still has JOIN knowledge).
  const edgeTouched = new Set<string>();
  for (const r of relationships) {
    edgeTouched.add(qualifiedName(r.fromSchema, r.fromTable));
    edgeTouched.add(qualifiedName(r.toSchema, r.toTable));
  }

  const isolatedTables = [...activeSet].filter((t) => !edgeTouched.has(t)).sort();

  // Connected components over active tables (edges between two active tables).
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
  };
  for (const r of relationships) {
    const a = qualifiedName(r.fromSchema, r.fromTable);
    const b = qualifiedName(r.toSchema, r.toTable);
    if (activeSet.has(a) && activeSet.has(b)) {
      link(a, b);
      link(b, a);
    }
  }
  let componentCount = 0;
  let largestComponent = 0;
  const visited = new Set<string>();
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    componentCount++;
    let size = 0;
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const node = queue.pop()!;
      size++;
      for (const next of adjacency.get(node) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    largestComponent = Math.max(largestComponent, size);
  }

  // FK-looking columns with no outgoing edge (the from-side of a relationship).
  const fromSides = new Set(
    relationships.map(
      (r) => `${qualifiedName(r.fromSchema, r.fromTable)}.${r.fromColumn.toLowerCase()}`,
    ),
  );
  const fkGaps: FkGap[] = columns
    .filter((c) => {
      const table = qualifiedName(c.schema, c.table);
      return (
        activeSet.has(table) &&
        c.columnKey !== "PRI" &&
        FK_NAME_PATTERN.test(c.column) &&
        !fromSides.has(`${table}.${c.column.toLowerCase()}`)
      );
    })
    .map((c) => ({
      table: qualifiedName(c.schema, c.table),
      column: c.column,
      dataType: c.dataType,
    }))
    .sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));

  const scopes: RuleScope[] = ["global", "term", "table"];
  const ruleStats = scopes.map((scope) => {
    const inScope = rules.filter((r) => r.scope === scope);
    return {
      scope,
      total: inScope.length,
      reviewed: inScope.filter((r) => r.reviewed).length,
    };
  });

  return {
    catalog: {
      total: catalog.length,
      reviewed: catalog.filter((c) => c.reviewed).length,
      excluded: catalog.filter((c) => c.excluded).length,
      described: catalog.filter((c) => c.description.trim() !== "").length,
      schemas: [...new Set(catalog.map((c) => c.schema))].sort(),
    },
    relationships: {
      total: relationships.length,
      reviewed: relationships.filter((r) => r.reviewed).length,
      tablesWithEdges: [...activeSet].filter((t) => edgeTouched.has(t)).length,
    },
    graph: { componentCount, largestComponent, isolatedTables },
    fkGaps,
    rules: ruleStats,
    analyticsAvailable,
  };
}
