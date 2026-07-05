import { verifyConnections } from "./lib/db";

/**
 * Node-only startup DB verification. Imported lazily from instrumentation.ts
 * under the `NEXT_RUNTIME === "nodejs"` guard so mysql2 is never pulled into the
 * Edge (middleware) bundle.
 */
export async function verifyAtStartup() {
  const checks = await verifyConnections();

  for (const c of checks) {
    if (!c.configured) {
      console.warn(`[db] ${c.name}: not configured (set ${c.name}_* env vars)`);
      continue;
    }
    if (!c.reachable) {
      console.error(`[db] ${c.name}: UNREACHABLE — ${c.error}`);
      continue;
    }
    if (c.name === "ANALYTICS_DB") {
      if (c.readOnly) {
        console.log(`[db] ${c.name}: connected, account is read-only ✓`);
      } else {
        console.error(
          `[db] ${c.name}: connected but account has WRITE/DDL privileges. ` +
            `Use a SELECT-only account on a replica.`,
        );
      }
    } else {
      console.log(`[db] ${c.name}: connected (read-write) ✓`);
    }
  }
}
