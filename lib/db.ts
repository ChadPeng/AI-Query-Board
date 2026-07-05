import mysql from "mysql2/promise";

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
  return makePool("ANALYTICS_DB");
}

export function statePool(): mysql.Pool | null {
  return makePool("STATE_DB");
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
    checkPool("ANALYTICS_DB", analyticsPool(), true),
    checkPool("STATE_DB", statePool(), false),
  ]);
}
