import { describe, expect, it } from "vitest";
import { compileExplorerQuery } from "./compile";
import type { DatasetFieldDef, DatasetModel, DatasetTableNode } from "./types";

function node(over: Partial<DatasetTableNode>): DatasetTableNode {
  return {
    alias: "o",
    schema: "mepay",
    table: "orders",
    parentAlias: null,
    parentColumn: null,
    childColumn: null,
    cardinality: null,
    relationshipId: null,
    ...over,
  };
}

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
    sortOrder: 0,
    ...over,
  };
}

const MODEL: DatasetModel = {
  id: 1,
  name: "訂單分析",
  description: null,
  authorId: 1,
  published: true,
  tables: [
    node({}),
    node({
      alias: "up",
      table: "user_profiles",
      parentAlias: "o",
      parentColumn: "user_id",
      childColumn: "user_id",
      cardinality: "many_to_one",
    }),
    node({
      alias: "u",
      table: "users",
      parentAlias: "up",
      parentColumn: "user_id",
      childColumn: "id",
      cardinality: "many_to_one",
    }),
  ],
  fields: [
    field({ id: 1, name: "月份", columnName: "created_at" }),
    field({ id: 2, name: "暱稱", tableAlias: "up", columnName: "nickname", dataType: "varchar" }),
    field({
      id: 3,
      kind: "measure",
      name: "營收",
      columnName: "total",
      dataType: "decimal",
      aggregation: "sum",
      conditionSql: "o.status = 4",
    }),
    field({ id: 4, kind: "measure", name: "訂單數", columnName: null, aggregation: "count" }),
  ],
};

describe("compileExplorerQuery", () => {
  it("compiles dimension + measures with date bucket, GROUP BY and default ORDER", () => {
    const { sql, values, columns } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 1, dateBucket: "month" }],
      measures: [{ fieldId: 3 }, { fieldId: 4 }],
      filters: [],
    });
    expect(sql).toContain("DATE_FORMAT(`o`.`created_at`, '%Y-%m') AS `月份`");
    expect(sql).toContain("SUM(CASE WHEN (o.status = 4) THEN `o`.`total` END) AS `營收`");
    expect(sql).toContain("COUNT(*) AS `訂單數`");
    expect(sql).toContain("GROUP BY DATE_FORMAT(`o`.`created_at`, '%Y-%m')");
    expect(sql).toContain("ORDER BY DATE_FORMAT(`o`.`created_at`, '%Y-%m') ASC");
    expect(sql).toContain("LIMIT 500");
    expect(values).toEqual([]);
    expect(columns.map((c) => c.key)).toEqual(["月份", "營收", "訂單數"]);
    // no dimension/filter touches up/u → joins pruned away
    expect(sql).not.toContain("LEFT JOIN");
  });

  it("prunes joins to the parent chain actually used", () => {
    const { sql } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 2 }],
      measures: [{ fieldId: 3 }],
      filters: [],
    });
    expect(sql).toContain(
      "LEFT JOIN `mepay`.`user_profiles` AS `up` ON `o`.`user_id` = `up`.`user_id`",
    );
    // u is not referenced → not joined
    expect(sql).not.toContain("`mepay`.`users`");
  });

  it("binds every filter value through ? placeholders", () => {
    const { sql, values } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 2 }],
      measures: [{ fieldId: 4 }],
      filters: [
        { fieldId: 1, op: "between", values: ["2026-06-01", "2026-07-01"] },
        { fieldId: 2, op: "in", values: ["a", "b", "c"] },
        { fieldId: 2, op: "contains", values: ["50%_off"] },
      ],
    });
    expect(sql).toContain("`o`.`created_at` BETWEEN ? AND ?");
    expect(sql).toContain("`up`.`nickname` IN (?, ?, ?)");
    expect(sql).toContain("`up`.`nickname` LIKE ?");
    expect(values).toEqual(["2026-06-01", "2026-07-01", "a", "b", "c", "%50\\%\\_off%"]);
  });

  it("measures only → single-row aggregate without GROUP BY", () => {
    const { sql } = compileExplorerQuery(MODEL, {
      dimensions: [],
      measures: [{ fieldId: 3 }],
      filters: [],
    });
    expect(sql).not.toContain("GROUP BY");
    expect(sql).not.toContain("ORDER BY");
  });

  it("dimension only → DISTINCT listing", () => {
    const { sql } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 2 }],
      measures: [],
      filters: [],
    });
    expect(sql).toContain("SELECT DISTINCT `up`.`nickname` AS `暱稱`");
  });

  it("sorts by a measure alias when asked", () => {
    const { sql } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 2 }],
      measures: [{ fieldId: 3 }],
      filters: [],
      sort: { by: 0, dir: "desc" },
      limit: 10,
    });
    expect(sql).toContain("ORDER BY `營收` DESC");
    expect(sql).toContain("LIMIT 10");
  });

  it("rejects: two dimensions, wrong field kind, unknown field, empty query", () => {
    expect(() =>
      compileExplorerQuery(MODEL, {
        dimensions: [{ fieldId: 1 }, { fieldId: 2 }],
        measures: [],
        filters: [],
      }),
    ).toThrow("一個維度");
    expect(() =>
      compileExplorerQuery(MODEL, { dimensions: [{ fieldId: 3 }], measures: [], filters: [] }),
    ).toThrow("不是維度");
    expect(() =>
      compileExplorerQuery(MODEL, { dimensions: [], measures: [{ fieldId: 99 }], filters: [] }),
    ).toThrow("不存在");
    expect(() =>
      compileExplorerQuery(MODEL, { dimensions: [], measures: [], filters: [] }),
    ).toThrow("至少");
  });

  it("clamps the limit", () => {
    const { sql } = compileExplorerQuery(MODEL, {
      dimensions: [{ fieldId: 2 }],
      measures: [{ fieldId: 4 }],
      filters: [],
      limit: 999999,
    });
    expect(sql).toContain("LIMIT 5000");
  });

  it("refuses to compile a model violating star invariants", () => {
    const broken: DatasetModel = {
      ...MODEL,
      fields: [field({ id: 9, kind: "measure", name: "壞", tableAlias: "up", columnName: "x", aggregation: "sum" })],
    };
    expect(() =>
      compileExplorerQuery(broken, { dimensions: [], measures: [{ fieldId: 9 }], filters: [] }),
    ).toThrow("模型不合法");
  });
});
