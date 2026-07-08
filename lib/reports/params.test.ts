import { describe, it, expect } from "vitest";
import { bindReportSql, normalizeParams, type ReportParam } from "./params";

const dateP: ReportParam = { name: "d", type: "date", label: "日期", required: true };
const numP: ReportParam = { name: "n", type: "number", label: "門檻", required: true };
const rangeP: ReportParam = { name: "period", type: "date_range", label: "期間", required: true };
const enumP: ReportParam = { name: "status", type: "enum", label: "狀態", required: true, options: ["paid", "refunded"] };

describe("bindReportSql — happy path", () => {
  it("replaces placeholders with ? and returns values in order, never inlining the value", () => {
    const r = bindReportSql(
      "SELECT * FROM orders WHERE created_at >= :d AND amount >= :n",
      [dateP, numP],
      { d: "2026-01-01", n: "100" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sql).toBe("SELECT * FROM orders WHERE created_at >= ? AND amount >= ?");
    expect(r.values).toEqual(["2026-01-01", 100]);
    // the concrete value must NOT appear in the SQL string
    expect(r.sql).not.toContain("2026-01-01");
    expect(r.sql).not.toContain("100");
  });

  it("expands a date_range into two ordered bound values", () => {
    const r = bindReportSql(
      "SELECT * FROM o WHERE d >= :period_start AND d < :period_end",
      [rangeP],
      { period: { start: "2026-01-01", end: "2026-02-01" } },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sql).toBe("SELECT * FROM o WHERE d >= ? AND d < ?");
    expect(r.values).toEqual(["2026-01-01", "2026-02-01"]);
  });

  it("binds a repeated placeholder once per occurrence", () => {
    const r = bindReportSql("SELECT :n, :n", [numP], { n: "5" });
    expect(r.ok && r.values).toEqual([5, 5]);
  });

  it("uses a default when the value is left blank", () => {
    const withDefault: ReportParam = { ...numP, required: false, default: "42" };
    const r = bindReportSql("SELECT :n", [withDefault], {});
    expect(r.ok && r.values).toEqual([42]);
  });

  it("accepts an allowed enum value", () => {
    const r = bindReportSql("SELECT :status", [enumP], { status: "paid" });
    expect(r.ok && r.values).toEqual(["paid"]);
  });
});

describe("bindReportSql — rejections", () => {
  it("rejects a missing required value", () => {
    const r = bindReportSql("SELECT :d", [dateP], {});
    expect(r.ok).toBe(false);
  });

  it("rejects a bad date", () => {
    const r = bindReportSql("SELECT :d", [dateP], { d: "not-a-date" });
    expect(r.ok).toBe(false);
  });

  it("rejects a non-numeric number", () => {
    const r = bindReportSql("SELECT :n", [numP], { n: "abc" });
    expect(r.ok).toBe(false);
  });

  it("rejects an enum value outside the allowed set", () => {
    const r = bindReportSql("SELECT :status", [enumP], { status: "hacked" });
    expect(r.ok).toBe(false);
  });

  it("rejects a placeholder the report never declared", () => {
    const r = bindReportSql("SELECT :d, :evil", [dateP], { d: "2026-01-01" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("evil");
  });

  it("rejects an incomplete date_range", () => {
    const r = bindReportSql("SELECT :period_start, :period_end", [rangeP], {
      period: { start: "2026-01-01" },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects a reversed date_range", () => {
    const r = bindReportSql("SELECT :period_start, :period_end", [rangeP], {
      period: { start: "2026-03-01", end: "2026-01-01" },
    });
    expect(r.ok).toBe(false);
  });
});

describe("bindReportSql — literal safety", () => {
  it("does not treat a colon-word inside a string literal as a placeholder", () => {
    const r = bindReportSql("SELECT * FROM t WHERE label = 'a:b' AND d >= :d", [dateP], {
      d: "2026-01-01",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // only the real placeholder became ?; the literal is untouched, one value bound
    expect(r.sql).toBe("SELECT * FROM t WHERE label = 'a:b' AND d >= ?");
    expect(r.values).toEqual(["2026-01-01"]);
  });

  it("does not treat a time literal as a placeholder", () => {
    const r = bindReportSql("SELECT * FROM t WHERE ts > '12:00:00'", [], {});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values).toEqual([]);
    expect(r.sql).toContain("'12:00:00'");
  });
});

describe("normalizeParams", () => {
  it("defaults label to name and required to true", () => {
    const out = normalizeParams([{ name: "d", type: "date" }]);
    expect(out).toEqual([{ name: "d", type: "date", label: "d", required: true }]);
  });
  it("rejects an invalid name", () => {
    expect(normalizeParams([{ name: "1bad", type: "date" }])).toBeTypeOf("string");
  });
  it("rejects duplicate names", () => {
    expect(
      normalizeParams([
        { name: "d", type: "date" },
        { name: "d", type: "number" },
      ]),
    ).toBeTypeOf("string");
  });
  it("requires options for an enum", () => {
    expect(normalizeParams([{ name: "s", type: "enum" }])).toBeTypeOf("string");
  });
});
