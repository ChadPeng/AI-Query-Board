import { describe, expect, it } from "vitest";
import { validateDatasetModel } from "./validate";
import type { DatasetFieldDef, DatasetTableNode } from "./types";

const base: DatasetTableNode = {
  alias: "o",
  schema: "mepay",
  table: "orders",
  parentAlias: null,
  parentColumn: null,
  childColumn: null,
  cardinality: null,
  relationshipId: null,
};
const joined: DatasetTableNode = {
  alias: "up",
  schema: "mepay",
  table: "user_profiles",
  parentAlias: "o",
  parentColumn: "user_id",
  childColumn: "user_id",
  cardinality: "many_to_one",
  relationshipId: 12,
};
const revenue: DatasetFieldDef = {
  id: 1,
  kind: "measure",
  name: "營收",
  description: null,
  tableAlias: "o",
  columnName: "total",
  dataType: "decimal",
  aggregation: "sum",
  conditionSql: "o.status = 4",
  valueLabels: null,
  sortOrder: 0,
};
const month: DatasetFieldDef = {
  id: 2,
  kind: "dimension",
  name: "月份",
  description: null,
  tableAlias: "o",
  columnName: "created_at",
  dataType: "datetime",
  aggregation: null,
  conditionSql: null,
  valueLabels: null,
  sortOrder: 1,
};

describe("validateDatasetModel", () => {
  it("accepts a well-formed star model", () => {
    expect(validateDatasetModel({ tables: [base, joined], fields: [revenue, month] })).toEqual([]);
  });

  it("requires exactly one base table", () => {
    expect(validateDatasetModel({ tables: [joined], fields: [] }).join()).toContain("基底表");
    expect(
      validateDatasetModel({ tables: [base, { ...joined, parentAlias: null }], fields: [] }).join(),
    ).toContain("恰有一張");
  });

  it("rejects a parent cycle and a dangling parent", () => {
    const a = { ...joined, alias: "a", parentAlias: "b" };
    const b = { ...joined, alias: "b", parentAlias: "a" };
    expect(validateDatasetModel({ tables: [base, a, b], fields: [] }).join()).toContain("成環");
    expect(
      validateDatasetModel({ tables: [base, { ...joined, parentAlias: "ghost" }], fields: [] }).join(),
    ).toContain("不存在");
  });

  it("enforces the star restriction: measures live on the base table", () => {
    const offBase = { ...revenue, tableAlias: "up" };
    expect(
      validateDatasetModel({ tables: [base, joined], fields: [offBase] }).join(),
    ).toContain("基底表");
  });

  it("rejects placeholders and semicolons in a measure condition", () => {
    for (const bad of ["o.status = ?", "o.status = :s", "1=1; DROP TABLE x"]) {
      const f = { ...revenue, conditionSql: bad };
      expect(validateDatasetModel({ tables: [base], fields: [f] }).length).toBeGreaterThan(0);
    }
  });

  it("rejects aggregation/condition on a dimension and missing measure column", () => {
    expect(
      validateDatasetModel({
        tables: [base],
        fields: [{ ...month, aggregation: "sum" }],
      }).join(),
    ).toContain("不可有聚合");
    expect(
      validateDatasetModel({
        tables: [base],
        fields: [{ ...revenue, columnName: null }],
      }).join(),
    ).toContain("缺少欄位");
    // count without a column is the one legal case
    expect(
      validateDatasetModel({
        tables: [base],
        fields: [{ ...revenue, columnName: null, aggregation: "count", conditionSql: null }],
      }),
    ).toEqual([]);
  });
});
