import { getCatalog } from "../state/catalog";
import {
  getCreateTablesFor,
  listColumnsInSchemas,
  qualifiedName,
} from "./introspect";
import { resolvePickedTable } from "./retrieval";

/**
 * Deterministic table supplement for the SQL-error repair loop (no LLM call).
 * When the model referenced a column or table outside the retrieved schema,
 * MySQL's error tells us exactly what it wanted — look it up in the catalog
 * and hand the model the missing DDL alongside the error, instead of hoping
 * it guesses the right fix from the error text alone.
 */

export interface SqlErrorLike {
  errno?: number;
  message: string;
}

/**
 * Pure decision: which qualified tables to add to the schema for this error.
 *  - 1054 (unknown column): tables holding that column — but only when ≤2
 *    candidates, so generic column names (status, type…) never flood the prompt.
 *  - 1146/1109 (unknown table): the unambiguous catalog match for the name.
 * `columnsByTable` maps qualified table → lowercase column names (null when the
 * analytics DB is unavailable).
 */
export function pickSupplementTables(
  err: SqlErrorLike,
  activeTables: string[],
  currentTables: string[],
  columnsByTable: Map<string, Set<string>> | null,
): string[] {
  const current = new Set(currentTables);

  if (err.errno === 1054 && columnsByTable) {
    const m = /Unknown column '([^']+)'/.exec(err.message);
    if (!m) return [];
    const column = m[1].split(".").pop()!.toLowerCase();
    const holders = activeTables.filter(
      (t) => !current.has(t) && columnsByTable.get(t)?.has(column),
    );
    return holders.length > 0 && holders.length <= 2 ? holders : [];
  }

  if (err.errno === 1146 || err.errno === 1109) {
    const m =
      /Table '([^']+)' doesn't exist/.exec(err.message) ??
      /Unknown table '([^']+)'/.exec(err.message);
    if (!m) return [];
    const known = new Set(activeTables);
    const resolved = resolvePickedTable(
      m[1],
      activeTables.map((t) => ({ table: t })),
      known,
    );
    return resolved && !current.has(resolved) ? [resolved] : [];
  }

  return [];
}

/**
 * IO wrapper: diagnose the MySQL error against the catalog and return the DDL
 * of at most 2 supplemental tables, or undefined. Best-effort — any failure
 * here just means the repair proceeds with the raw error only.
 */
export async function supplementDdlForSqlError(
  e: unknown,
  currentTables: string[],
): Promise<string | undefined> {
  const err = e as { errno?: number; message?: string } | null;
  if (!err?.message) return undefined;
  try {
    const catalog = await getCatalog();
    const active = catalog.filter((c) => !c.excluded);
    if (active.length === 0) return undefined;
    const activeTables = active.map((c) => qualifiedName(c.schema, c.table));

    let columnsByTable: Map<string, Set<string>> | null = null;
    if (err.errno === 1054) {
      const schemas = [...new Set(active.map((c) => c.schema))];
      const cols = await listColumnsInSchemas(schemas);
      columnsByTable = new Map();
      for (const c of cols) {
        const t = qualifiedName(c.schema, c.table);
        (columnsByTable.get(t) ?? columnsByTable.set(t, new Set()).get(t)!).add(
          c.column.toLowerCase(),
        );
      }
    }

    const toAdd = pickSupplementTables(
      { errno: err.errno, message: err.message },
      activeTables,
      currentTables,
      columnsByTable,
    );
    if (toAdd.length === 0) return undefined;
    const ddl = await getCreateTablesFor(toAdd);
    return ddl.trim() ? ddl : undefined;
  } catch {
    return undefined;
  }
}
