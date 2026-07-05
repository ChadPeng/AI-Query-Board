/**
 * Bootstrap the table catalog (slice 03, PRD §3.1), SCHEMA-AWARE, with
 * throttling / subset / resume so it's safe on a free-tier LLM.
 *
 *   introspect chosen schema(s)  ->  for each table: DDL + sample rows
 *   ->  LLM generates a one-line description  ->  upsert into state DB
 *
 * Flags (all optional):
 *   --schemas=db1,db2     schemas to include (else ANALYTICS_SCHEMAS / ANALYTICS_DB_DATABASE)
 *   --include=sales_*,customer_*   only tables matching these globs (name or schema.table)
 *   --exclude=*_tmp,*_log          skip tables matching these globs
 *   --limit=50            cap the number of tables processed this run
 *   --rpm=12              throttle to N LLM requests/minute (free-tier friendly)
 *   --force               re-describe even tables already in the catalog (default: skip = resume)
 *
 * Resume: by default already-cataloged tables are skipped, so if a run is
 * interrupted (rate limit, Ctrl-C) just run it again — it continues where it
 * left off. Human-reviewed rows (reviewed=1) are preserved regardless.
 *
 *   npm run bootstrap:catalog -- --include=sales_*,customer_* --rpm=10
 */
import { statePool } from "../lib/db";
import { runStateMigrations } from "../lib/state/migrate";
import { upsertCatalogEntry, getCatalog } from "../lib/state/catalog";
import {
  listSchemas,
  listTablesInSchemas,
  getCreateTable,
  sampleRows,
  getAnalyticsSchemas,
  type SchemaTable,
} from "../lib/schema/introspect";
import { createProvider, missingProviderKey } from "../lib/llm/factory";
import type { LLMProvider } from "../lib/llm/provider";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function argVal(name: string): string | undefined {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : undefined;
}
function argFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function listArg(name: string): string[] | null {
  const v = argVal(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : null;
}

function globToRegExp(p: string): RegExp {
  const body = p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}$`, "i");
}
function matchesAny(patterns: RegExp[], t: SchemaTable): boolean {
  const qualified = `${t.schema}.${t.table}`;
  return patterns.some((re) => re.test(t.table) || re.test(qualified));
}

/** Transient LLM errors worth retrying: rate limits (429) AND server overload (503). */
function isRetryable(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e);
  return /\b429\b|\b503\b|RESOURCE_EXHAUSTED|quota|rate.?limit|UNAVAILABLE|overloaded|high demand/i.test(
    s,
  );
}

async function describeWithRetry(
  provider: LLMProvider,
  args: { table: string; createTable: string; sampleRows: Record<string, unknown>[] },
  retries = 5,
): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await provider.describeTable(args);
    } catch (e) {
      if (attempt >= retries || !isRetryable(e)) throw e;
      // Backoff grows: 8s, 16s, 24s, ... (handles both 429 rate limits and 503 overload).
      const backoff = 8000 * (attempt + 1);
      console.log(`    ⏳ 暫時性錯誤（限流/過載），退避 ${backoff / 1000}s 後重試…`);
      await sleep(backoff);
    }
  }
}

async function main() {
  const sp = statePool();
  if (!sp) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  const keyError = missingProviderKey();
  if (keyError) throw new Error(keyError);

  console.log("[catalog] 確保 table_catalog 結構…");
  await runStateMigrations(sp);

  try {
    const available = await listSchemas();
    console.log(`[catalog] 分析帳號可見的 schema：${available.join(", ") || "(無)"}`);
  } catch {
    /* SCHEMATA may be restricted; not fatal */
  }

  const schemas = listArg("schemas") ?? getAnalyticsSchemas();
  if (schemas.length === 0) {
    throw new Error(
      "未指定 schema：設定 ANALYTICS_SCHEMAS 或 ANALYTICS_DB_DATABASE，或用 --schemas=db1,db2",
    );
  }
  console.log(`[catalog] 本次納入的 schema：${schemas.join(", ")}`);

  // Config
  const rpm = Math.max(1, Number(argVal("rpm")) || 12);
  const delayMs = Math.ceil(60000 / rpm);
  const limit = Math.max(0, Number(argVal("limit")) || 0);
  const force = argFlag("force");
  const include = listArg("include")?.map(globToRegExp) ?? null;
  const exclude = listArg("exclude")?.map(globToRegExp) ?? null;

  // Discover + filter
  let tables = await listTablesInSchemas(schemas);
  const total = tables.length;
  if (include) tables = tables.filter((t) => matchesAny(include, t));
  if (exclude) tables = tables.filter((t) => !matchesAny(exclude, t));

  let skipped = 0;
  if (!force) {
    const existing = new Set((await getCatalog()).map((c) => `${c.schema}.${c.table}`));
    const before = tables.length;
    tables = tables.filter((t) => !existing.has(`${t.schema}.${t.table}`));
    skipped = before - tables.length;
  }
  if (limit > 0) tables = tables.slice(0, limit);

  console.log(
    `[catalog] 共 ${total} 張表；過濾後待處理 ${tables.length} 張` +
      (skipped ? `（略過已存在 ${skipped}）` : "") +
      `，節流 ${rpm} RPM（每次間隔 ~${(delayMs / 1000).toFixed(1)}s）`,
  );

  const provider = createProvider();
  let ok = 0;
  let failed = 0;

  for (const [i, { schema, table }] of tables.entries()) {
    if (i > 0) await sleep(delayMs);
    const label = `${schema}.${table}`;
    try {
      const [createTable, rows] = await Promise.all([
        getCreateTable(schema, table),
        sampleRows(schema, table, 3),
      ]);
      const description = await describeWithRetry(provider, {
        table: label,
        createTable,
        sampleRows: rows,
      });
      await upsertCatalogEntry(schema, table, description);
      ok++;
      console.log(`  [${i + 1}/${tables.length}] ${label} — ${description}`);
    } catch (e) {
      failed++;
      console.error(
        `  [${i + 1}/${tables.length}] ${label} — 失敗：${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  console.log(`[catalog] 完成：${ok} 成功，${failed} 失敗，${skipped} 略過。`);
  if (failed > 0) {
    console.log("[catalog] 有失敗項目——直接重跑本指令即可從未完成處續跑（已成功的會被略過）。");
  }
  console.log(
    "[catalog] 下一步：校對最關鍵的 20-30 張表，確認描述正確後將該列 reviewed 設為 1。",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[catalog] 中止：", e instanceof Error ? e.message : e);
    process.exit(1);
  });
