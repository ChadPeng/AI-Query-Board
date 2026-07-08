import { verifyConnections } from "./lib/db";

/**
 * Node-only startup DB verification. Imported lazily from instrumentation.ts
 * under the `NEXT_RUNTIME === "nodejs"` guard so mysql2 is never pulled into the
 * Edge (middleware) bundle.
 *
 * IMPORTANT: this must never throw. `register()` failing kills the whole server
 * instance — on Vercel that turns every request to that lambda into an opaque
 * HTML 500. Verification is a health report, not a boot gate.
 */
export async function verifyAtStartup() {
  try {
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
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e);
    console.error(`[db] startup verification failed (non-fatal): ${msg}`);
  }
}
