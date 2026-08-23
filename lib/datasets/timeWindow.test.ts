import { describe, expect, it } from "vitest";
import { enforceTimeWindow } from "./timeWindow";
import type { DatasetFieldDef, DatasetModel, ExplorerQuery } from "./types";

function field(over: Partial<DatasetFieldDef>): DatasetFieldDef {
  return {
    id: 0,
    kind: "dimension",
    name: "x",
    description: null,
    tableAlias: "o",
    columnName: "created_at",
    dataType: "datetime",
    aggregation: null,
    conditionSql: null,
    valueLabels: null,
    sortOrder: 0,
    ...over,
  };
}

function model(fields: DatasetFieldDef[]): DatasetModel {
  return {
    id: 1,
    name: "m",
    description: null,
    authorId: 1,
    published: true,
    tables: [],
    fields,
  };
}

const NOW = new Date("2026-08-24T12:00:00Z");

const query = (filters: ExplorerQuery["filters"] = []): ExplorerQuery => ({
  dimensions: [],
  measures: [{ fieldId: 3 }],
  filters,
});

describe("enforceTimeWindow", () => {
  it("no temporal dimension → query passes through unchanged", () => {
    const m = model([field({ id: 1, name: "類別", dataType: "varchar" })]);
    const q = query();
    expect(enforceTimeWindow(m, q, NOW)).toBe(q);
  });

  it("valid window (≤366 days) passes through unchanged", () => {
    const m = model([field({ id: 1, name: "月份" })]);
    const q = query([{ fieldId: 1, op: "between", values: ["2026-01-01", "2026-06-30"] }]);
    expect(enforceTimeWindow(m, q, NOW)).toBe(q);
  });

  it("window over a year → error message", () => {
    const m = model([field({ id: 1, name: "月份" })]);
    const q = query([{ fieldId: 1, op: "between", values: ["2024-01-01", "2026-06-30"] }]);
    const r = enforceTimeWindow(m, q, NOW);
    expect(typeof r).toBe("string");
    expect(String(r)).toContain("最長一年");
  });

  it("missing window → injects default last-365-days on the first temporal dim", () => {
    const m = model([
      field({ id: 9, name: "類別", dataType: "varchar" }),
      field({ id: 1, name: "月份" }),
      field({ id: 2, name: "出貨日", dataType: "date" }),
    ]);
    const r = enforceTimeWindow(m, query(), NOW);
    expect(typeof r).not.toBe("string");
    const injected = (r as ExplorerQuery).filters.at(-1)!;
    expect(injected.fieldId).toBe(1); // 第一個時間維度
    expect(injected.op).toBe("between");
    expect(injected.values[0]).toBe("2025-08-24");
    expect(injected.values[1]).toBe("2026-08-24 23:59:59");
  });

  it("a between on a NON-temporal dim does not satisfy the window", () => {
    const m = model([
      field({ id: 1, name: "月份" }),
      field({ id: 9, name: "金額區間", dataType: "int" }),
    ]);
    const r = enforceTimeWindow(m, query([{ fieldId: 9, op: "between", values: ["1", "100"] }]), NOW);
    expect(typeof r).not.toBe("string");
    expect((r as ExplorerQuery).filters).toHaveLength(2); // 仍注入時間窗
  });

  it("unparseable dates in the between are ignored → default injected", () => {
    const m = model([field({ id: 1, name: "月份" })]);
    const r = enforceTimeWindow(m, query([{ fieldId: 1, op: "between", values: ["abc", "def"] }]), NOW);
    expect(typeof r).not.toBe("string");
    expect((r as ExplorerQuery).filters).toHaveLength(2);
  });
});
