import { describe, it, expect } from "vitest";
import { enforceRowLimit, isRetryableSqlError } from "./guardrails";

describe("enforceRowLimit", () => {
  it("wraps a plain SELECT as a derived table with the given cap", () => {
    const out = enforceRowLimit("SELECT * FROM orders", 1000);
    expect(out).toContain("SELECT * FROM (");
    expect(out).toContain(") AS _guarded LIMIT 1000");
  });

  it("caps an inner LIMIT by wrapping (inner LIMIT can't exceed the cap)", () => {
    const out = enforceRowLimit("SELECT * FROM orders LIMIT 999999", 1000);
    // The whole query is wrapped, so the outer LIMIT bounds the result set.
    expect(out).toMatch(/\) AS _guarded LIMIT 1000$/);
  });

  it("respects a caller-supplied cap (report preview cap differs from chat)", () => {
    expect(enforceRowLimit("SELECT 1", 5000)).toContain("LIMIT 5000");
  });

  it("appends a LIMIT to a CTE query that has none (can't wrap a WITH as a derived table)", () => {
    const out = enforceRowLimit("WITH t AS (SELECT 1 AS n) SELECT * FROM t", 1000);
    expect(out.startsWith("WITH")).toBe(true);
    expect(out).toMatch(/LIMIT 1000$/);
  });

  it("leaves a CTE query that already has a LIMIT untouched", () => {
    const sql = "WITH t AS (SELECT 1 AS n) SELECT * FROM t LIMIT 10";
    expect(enforceRowLimit(sql, 1000)).toBe(sql);
  });

  it("strips a trailing semicolon before wrapping", () => {
    const out = enforceRowLimit("SELECT 1;", 1000);
    expect(out).not.toContain(";");
    expect(out).toContain(") AS _guarded LIMIT 1000");
  });
});

describe("isRetryableSqlError", () => {
  const err = (errno: number, code?: string) =>
    Object.assign(new Error(`errno ${errno}`), { errno, code });

  it("whitelists model-fixable SQL errors", () => {
    for (const errno of [1054, 1146, 1064, 1052, 1055, 1109]) {
      expect(isRetryableSqlError(err(errno))).toBe(true);
    }
  });

  it("rejects permission / connection / unknown errors", () => {
    expect(isRetryableSqlError(err(1045))).toBe(false); // access denied
    expect(isRetryableSqlError(err(1142))).toBe(false); // command denied
    expect(isRetryableSqlError({ code: "ECONNREFUSED" })).toBe(false);
    expect(isRetryableSqlError(new Error("boom"))).toBe(false);
    expect(isRetryableSqlError(null)).toBe(false);
  });

  it("never retries a timeout even if an errno matched", () => {
    // MariaDB timeout errno 1969 isn't whitelisted, but guard explicitly:
    expect(isRetryableSqlError(err(3024, "ER_QUERY_TIMEOUT"))).toBe(false);
    expect(isRetryableSqlError(Object.assign(err(1054), { code: "ETIMEDOUT" }))).toBe(false);
  });
});
