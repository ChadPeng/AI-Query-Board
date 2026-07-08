import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./lib/db", () => ({ verifyConnections: vi.fn() }));

import { verifyAtStartup } from "./instrumentation-node";
import { verifyConnections } from "./lib/db";

/**
 * Regression: a transient DB failure during startup verification (e.g. connect
 * ETIMEDOUT from a Vercel cold start to the remote MySQL) must NOT propagate out
 * of verifyAtStartup — `register()` rejecting kills the whole server instance and
 * every request to it becomes an opaque HTML 500.
 */
describe("verifyAtStartup", () => {
  beforeEach(() => {
    vi.mocked(verifyConnections).mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("does not reject when verifyConnections rejects", async () => {
    vi.mocked(verifyConnections).mockRejectedValue(new Error("connect ETIMEDOUT"));
    await expect(verifyAtStartup()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("startup verification failed (non-fatal)"),
    );
  });

  it("reports check results when verification succeeds", async () => {
    vi.mocked(verifyConnections).mockResolvedValue([
      { name: "ANALYTICS_DB", configured: true, reachable: true, readOnly: true },
      { name: "STATE_DB", configured: true, reachable: true },
    ]);
    await expect(verifyAtStartup()).resolves.toBeUndefined();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("read-only"));
  });
});
