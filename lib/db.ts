import mysql from "mysql2/promise";
import { resolveAnalyticsConfig } from "./settings/config";

/**
 * Two physically separate MySQL connections (see PRD §5):
 *
 *  - analyticsPool — the EXISTING database being queried. Read-only account,
 *    ideally pointed at a replica. text-to-SQL queries run here.
 *  - statePool     — the app's OWN database. Read-write. Stores conversations,
 *    dashboards, saved queries, and the table catalog.
 *
 * Pools are cached on globalThis so Next.js dev hot-reloads don't leak
 * connections by recreating pools on every module reevaluation.
 */

type PoolKey = "ANALYTICS_DB" | "STATE_DB";

const globalForDb = globalThis as unknown as {
  __pools?: Partial<Record<PoolKey, mysql.Pool>>;
  /** signature of the analytics pool's current config, for hot-reload */
  __analyticsSig?: string;
};

globalForDb.__pools ??= {};

function makePool(prefix: PoolKey): mysql.Pool | null {
  const host = process.env[`${prefix}_HOST`];
  // Not configured yet — let the app boot so the skeleton is runnable
  // before real DB credentials exist. Verification will report it.
  if (!host) return null;

  const cached = globalForDb.__pools![prefix];
  if (cached) return cached;

  const pool = mysql.createPool({
    host,
    port: Number(process.env[`${prefix}_PORT`] ?? 3306),
    user: process.env[`${prefix}_USER`],
    password: process.env[`${prefix}_PASSWORD`],
    database: process.env[`${prefix}_DATABASE`] || undefined,
    waitForConnections: true,
    connectionLimit: 5,
    // Defense-in-depth: never let a generated query run multiple statements.
    multipleStatements: false,
  });

  globalForDb.__pools![prefix] = pool;
  return pool;
}

export function analyticsPool(): mysql.Pool | null {
  // Sync accessor: return whatever ensureAnalyticsPool last built, else fall back
  // to an env-built pool (keeps ops scripts working without the settings layer).
  return globalForDb.__pools!.ANALYTICS_DB ?? makePool("ANALYTICS_DB");
}

export function statePool(): mysql.Pool | null {
  return makePool("STATE_DB");
}

/**
 * Resolve the analytics connection from Settings (docs/adr/0005) and (re)build the
 * pool when the config changes — so a Super-Admin can repoint the analytics DB /
 * swap in a replica at runtime without a restart. Async entry points (the engine,
 * report run/preview/export, health) call this before using analyticsPool().
 */
export async function ensureAnalyticsPool(): Promise<mysql.Pool | null> {
  const cfg = await resolveAnalyticsConfig();
  if (!cfg.host) {
    // Not configured via settings/env → tear down any stale pool, report absent.
    if (globalForDb.__pools!.ANALYTICS_DB) {
      await globalForDb.__pools!.ANALYTICS_DB!.end().catch(() => {});
      delete globalForDb.__pools!.ANALYTICS_DB;
      globalForDb.__analyticsSig = undefined;
    }
    return null;
  }
  const sig = JSON.stringify(cfg);
  const existing = globalForDb.__pools!.ANALYTICS_DB;
  if (existing && globalForDb.__analyticsSig === sig) return existing;

  // Config changed (or first build): dispose the old pool and create a new one.
  if (existing) await existing.end().catch(() => {});
  const pool = mysql.createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user || undefined,
    password: cfg.password || undefined,
    database: cfg.database || undefined,
    waitForConnections: true,
    connectionLimit: 5,
    multipleStatements: false,
  });
  globalForDb.__pools!.ANALYTICS_DB = pool;
  globalForDb.__analyticsSig = sig;
  return pool;
}

export type ConnectionCheck =
  | { name: PoolKey; configured: false }
  | {
      name: PoolKey;
      configured: true;
      reachable: boolean;
      error?: string;
      /** Only probed for the analytics pool. true = confirmed SELECT-only. */
      readOnly?: boolean;
    };

async function checkReachable(pool: mysql.Pool): Promise<void> {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
  } finally {
    conn.release();
  }
}

/**
 * Confirms the analytics account cannot write. We attempt a DDL statement that
 * is harmless when permitted (DROP TABLE IF EXISTS on a name that does not
 * exist is a no-op) but is rejected with a privilege error (1142) for a
 * SELECT-only account. A throw therefore means "good, truly read-only".
 */
async function probeReadOnly(pool: mysql.Pool): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    await conn.query("DROP TABLE IF EXISTS `__readonly_probe__`");
    // Did NOT throw → the account has DDL/write privileges. Dangerous.
    return false;
  } catch {
    // Privilege error → cannot write → read-only as required.
    return true;
  } finally {
    conn.release();
  }
}

async function checkPool(
  name: PoolKey,
  pool: mysql.Pool | null,
  probeReadOnlyFlag: boolean,
): Promise<ConnectionCheck> {
  if (!pool) return { name, configured: false };
  try {
    await checkReachable(pool);
    const readOnly = probeReadOnlyFlag ? await probeReadOnly(pool) : undefined;
    return { name, configured: true, reachable: true, readOnly };
  } catch (err) {
    return {
      name,
      configured: true,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Verify both connections. Used at startup and by /api/health. */
export async function verifyConnections(): Promise<ConnectionCheck[]> {
  return Promise.all([
    checkPool("ANALYTICS_DB", await ensureAnalyticsPool(), true),
    checkPool("STATE_DB", statePool(), false),
  ]);
}
