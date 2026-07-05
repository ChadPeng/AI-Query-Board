/**
 * Bootstrap the Semantic Layer (slice 11, see docs/adr/0002) — the AI-assisted
 * cold start. Deterministic heuristics, no LLM calls (so it's quota-free and
 * safe to re-run):
 *
 *   Relationships — for every `xxx_id` column, find a table whose name matches
 *     `xxx` (singular/plural) with a single-column primary key, and draft a
 *     many-to-one edge `table.xxx_id -> target.pk`.
 *   Code-dictionary rules — for every ENUM column, draft a table-scoped rule
 *     listing the allowed values for a human to annotate with meanings.
 *
 * Everything is written reviewed=0 (unconfirmed): it's fed to the LLM but marked
 * so, and highlighted in the management UI for a human to confirm. Re-running is
 * idempotent and never clobbers a human-reviewed row.
 *
 * Flags: --schemas=db1,db2  (else ANALYTICS_SCHEMAS / ANALYTICS_DB_DATABASE)
 *
 *   npm run bootstrap:semantics -- --schemas=shop
 */
import { statePool } from "../lib/db";
import { runStateMigrations } from "../lib/state/migrate";
import {
  listColumnsInSchemas,
  getAnalyticsSchemas,
  qualifiedName,
  type ColumnInfo,
} from "../lib/schema/introspect";
import {
  createRelationship,
  type NewRelationship,
} from "../lib/state/relationships";
import { createRule, listRules } from "../lib/state/semanticRules";

function argVal(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}
function listArg(name: string): string[] | null {
  const v = argVal(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
}

/** crude singular/plural fold so order↔orders, user↔users, category↔categories match. */
function normName(n: string): string {
  const s = n.toLowerCase();
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  if (s.endsWith("ses")) return s.slice(0, -2);
  if (s.endsWith("s")) return s.slice(0, -1);
  return s;
}

/** Parse enum('a','b','c') → ["a","b","c"]. */
function enumValues(columnType: string): string[] {
  const m = columnType.match(/^enum\((.*)\)$/i);
  if (!m) return [];
  return [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1].replace(/''/g, "'"));
}

interface TargetTable {
  schema: string;
  table: string;
  pk: string;
}

async function main() {
  const sp = statePool();
  if (!sp) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");

  console.log("[semantics] 確保語意層結構…");
  await runStateMigrations(sp);

  const schemas = listArg("schemas") ?? getAnalyticsSchemas();
  if (schemas.length === 0) {
    throw new Error("未指定 schema：設定 ANALYTICS_SCHEMAS 或 --schemas=db1,db2");
  }
  console.log(`[semantics] 掃描 schema：${schemas.join(", ")}`);

  const columns = await listColumnsInSchemas(schemas);

  // Index single-column PKs by normalized table name (prefer per-schema lookup).
  const pkByTable = new Map<string, string>(); // "schema.table" -> pk column
  const pkCount = new Map<string, number>();
  for (const c of columns) {
    const key = qualifiedName(c.schema, c.table);
    if (c.columnKey === "PRI") {
      pkByTable.set(key, c.column);
      pkCount.set(key, (pkCount.get(key) ?? 0) + 1);
    }
  }
  const targetsByNorm = new Map<string, TargetTable[]>();
  for (const [key, pk] of pkByTable) {
    if ((pkCount.get(key) ?? 0) !== 1) continue; // skip composite PKs (ambiguous)
    const [schema, table] = key.split(".");
    const arr = targetsByNorm.get(normName(table)) ?? [];
    arr.push({ schema, table, pk });
    targetsByNorm.set(normName(table), arr);
  }

  // --- Relationship inference ---
  let relOk = 0;
  for (const c of columns) {
    const m = c.column.match(/^(.*)_id$/i);
    if (!m || !m[1]) continue;
    const base = normName(m[1]);
    const candidates = targetsByNorm.get(base);
    if (!candidates || candidates.length === 0) continue;
    // Prefer a target in the same schema, else the first.
    const target =
      candidates.find((t) => t.schema === c.schema) ?? candidates[0];
    // Skip a column pointing at its own PK (that's the PK itself, not an FK).
    if (target.schema === c.schema && target.table === c.table && target.pk === c.column) {
      continue;
    }
    const edge: NewRelationship = {
      fromSchema: c.schema,
      fromTable: c.table,
      fromColumn: c.column,
      toSchema: target.schema,
      toTable: target.table,
      toColumn: target.pk,
      cardinality: "many_to_one",
      reviewed: false,
    };
    try {
      await createRelationship(edge);
      relOk++;
      console.log(
        `  關係 ${c.schema}.${c.table}.${c.column} → ${target.schema}.${target.table}.${target.pk}`,
      );
    } catch (e) {
      console.error(`  關係失敗 ${c.schema}.${c.table}.${c.column}：${e instanceof Error ? e.message : e}`);
    }
  }

  // --- Code-dictionary rule inference (ENUM columns) ---
  // Idempotent: skip if an identical draft rule already exists.
  const existing = new Set(
    (await listRules())
      .filter((r) => r.scope === "table" && r.table)
      .map((r) => `${r.table}||${r.content}`),
  );
  let ruleOk = 0;
  const enumCols = columns.filter((c: ColumnInfo) => c.dataType.toLowerCase() === "enum");
  for (const c of enumCols) {
    const vals = enumValues(c.columnType);
    if (vals.length === 0) continue;
    const table = qualifiedName(c.schema, c.table);
    const content = `欄位 \`${c.column}\` 是列舉型，可能值：${vals.join("、")}。（請補充每個值的業務含義）`;
    if (existing.has(`${table}||${content}`)) continue;
    try {
      await createRule({ scope: "table", table, content, reviewed: false });
      ruleOk++;
      console.log(`  代碼字典 ${table}.${c.column}（${vals.length} 值）`);
    } catch (e) {
      console.error(`  規則失敗 ${table}.${c.column}：${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(
    `[semantics] 完成：關係草稿 ${relOk} 條、代碼字典草稿 ${ruleOk} 條（皆 reviewed=0）。`,
  );
  console.log(
    "[semantics] 下一步：到「語意層」管理頁校對這些草稿，並補上業務術語規則（如「創作者=user.is_creator=1」）。",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[semantics] 中止：", e instanceof Error ? e.message : e);
    process.exit(1);
  });
