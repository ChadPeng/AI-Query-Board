/**
 * Next runs register() once per runtime at server start. The DB verification
 * touches mysql2 (Node-only), so it must NOT be bundled for the Edge runtime
 * (which exists because middleware.ts does). The documented pattern: do the
 * node-only work in a separate module imported only under the nodejs guard, so
 * the Edge build never resolves mysql2.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { verifyAtStartup } = await import("./instrumentation-node");
    await verifyAtStartup();
  }
}
