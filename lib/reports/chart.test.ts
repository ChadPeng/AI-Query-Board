import { describe, it, expect } from "vitest";
import { validateChartSpec, normalizeChartSpec, isOutputMode } from "./chart";
import type { ChartSpec } from "../llm/types";

const good: ChartSpec = { chart_type: "bar", x: "category", y: ["revenue"], title: "營收", aggregation: "sum" };

describe("validateChartSpec", () => {
  it("accepts a structurally valid spec", () => {
    expect(validateChartSpec(good)).toBeNull();
  });
  it("rejects a missing x", () => {
    expect(validateChartSpec({ ...good, x: "" })).toBeTypeOf("string");
  });
  it("rejects empty y", () => {
    expect(validateChartSpec({ ...good, y: [] })).toBeTypeOf("string");
  });
  it("rejects an invalid chart type", () => {
    expect(validateChartSpec({ ...good, chart_type: "table" as ChartSpec["chart_type"] })).toBeTypeOf("string");
  });
  it("passes when referenced fields exist in the result columns", () => {
    expect(validateChartSpec(good, ["category", "revenue", "extra"])).toBeNull();
  });
  it("rejects when a referenced field is absent from the result columns", () => {
    const err = validateChartSpec(good, ["category", "other"]);
    expect(err).toBeTypeOf("string");
    expect(err).toContain("revenue");
  });
});

describe("normalizeChartSpec", () => {
  it("trims and fills defaults", () => {
    const out = normalizeChartSpec({ chart_type: "line", x: " day ", y: [" n ", ""], title: " t " });
    expect(out).toEqual({ chart_type: "line", x: "day", y: ["n"], title: "t", aggregation: "none" });
  });
  it("rejects a bad payload", () => {
    expect(normalizeChartSpec(null)).toBeTypeOf("string");
    expect(normalizeChartSpec({ chart_type: "nope", x: "a", y: ["b"] })).toBeTypeOf("string");
  });
});

describe("isOutputMode", () => {
  it("accepts the three modes and rejects others", () => {
    expect(isOutputMode("both")).toBe(true);
    expect(isOutputMode("chart")).toBe(true);
    expect(isOutputMode("table")).toBe(true);
    expect(isOutputMode("grid")).toBe(false);
  });
});
