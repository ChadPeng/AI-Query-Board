import { describe, expect, it } from "vitest";
import { computeCoverage } from "./coverage";
import type { CatalogEntry } from "../state/catalog";
import type { Relationship } from "../state/relationships";
import type { SemanticRule } from "../state/semanticRules";
import type { ColumnInfo } from "./introspect";

function entry(table: string, over: Partial<CatalogEntry> = {}): CatalogEntry {
  return { schema: "mepay", table, description: `${table} 表`, reviewed: false, excluded: false, ...over };
}

function edge(fromTable: string, fromColumn: string, toTable: string, over: Partial<Relationship> = {}): Relationship {
  return {
    id: 1,
    fromSchema: "mepay",
    fromTable,
    fromColumn,
    toSchema: "mepay",
    toTable,
    toColumn: "id",
    cardinality: "many_to_one",
    reviewed: false,
    ...over,
  };
}

function col(table: string, column: string, over: Partial<ColumnInfo> = {}): ColumnInfo {
  return { schema: "mepay", table, column, dataType: "int", columnType: "int", columnKey: "", ...over };
}

function rule(scope: SemanticRule["scope"], reviewed = false): SemanticRule {
  return { id: 1, scope, termName: null, table: null, content: "r", reviewed };
}

describe("computeCoverage", () => {
  it("counts catalog / relationship / rule totals and reviewed", () => {
    const stats = computeCoverage(
      [entry("orders", { reviewed: true }), entry("users"), entry("logs", { excluded: true, description: "" })],
      [edge("orders", "user_id", "users", { reviewed: true })],
      [rule("global", true), rule("term"), rule("table")],
      [],
      true,
    );
    expect(stats.catalog).toEqual({ total: 3, reviewed: 1, excluded: 1, described: 2, schemas: ["mepay"] });
    expect(stats.relationships.total).toBe(1);
    expect(stats.relationships.reviewed).toBe(1);
    expect(stats.rules).toEqual([
      { scope: "global", total: 1, reviewed: 1 },
      { scope: "term", total: 1, reviewed: 0 },
      { scope: "table", total: 1, reviewed: 0 },
    ]);
  });

  it("finds isolated tables and connected components", () => {
    // orders—users connected; payments—refunds connected; lonely isolated.
    const stats = computeCoverage(
      [entry("orders"), entry("users"), entry("payments"), entry("refunds"), entry("lonely")],
      [edge("orders", "user_id", "users"), edge("refunds", "payment_id", "payments")],
      [],
      [],
      true,
    );
    expect(stats.graph.isolatedTables).toEqual(["mepay.lonely"]);
    expect(stats.graph.componentCount).toBe(2);
    expect(stats.graph.largestComponent).toBe(2);
    expect(stats.relationships.tablesWithEdges).toBe(4);
  });

  it("ignores excluded tables for isolation and components", () => {
    const stats = computeCoverage(
      [entry("orders"), entry("scratch", { excluded: true })],
      [],
      [],
      [],
      true,
    );
    expect(stats.graph.isolatedTables).toEqual(["mepay.orders"]);
    expect(stats.graph.componentCount).toBe(0);
  });

  it("lists FK-looking columns without an outgoing edge as gaps", () => {
    const stats = computeCoverage(
      [entry("orders"), entry("users")],
      [edge("orders", "user_id", "users")],
      [],
      [
        col("orders", "id", { columnKey: "PRI" }), // PK — not a gap
        col("orders", "user_id"), // covered by the edge — not a gap
        col("orders", "buyer_uid"), // gap
        col("orders", "ref_no", { dataType: "varchar" }), // gap
        col("orders", "total"), // not FK-looking
        col("users", "uid"), // gap (^uid$)
      ],
      true,
    );
    expect(stats.fkGaps).toEqual([
      { table: "mepay.orders", column: "buyer_uid", dataType: "int" },
      { table: "mepay.orders", column: "ref_no", dataType: "varchar" },
      { table: "mepay.users", column: "uid", dataType: "int" },
    ]);
  });

  it("skips FK gaps on excluded tables and matches case-insensitively", () => {
    const stats = computeCoverage(
      [entry("orders"), entry("logs", { excluded: true })],
      [edge("orders", "USER_ID", "users")],
      [],
      [col("logs", "user_id"), col("orders", "User_Id")],
      true,
    );
    // logs is excluded; orders.User_Id matches the edge's USER_ID case-insensitively.
    expect(stats.fkGaps).toEqual([]);
  });
});
