import { describe, it, expect } from "vitest";
import { enforceRowLimit } from "./guardrails";

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
