import { describe, it, expect } from "vitest";
import { connectTables } from "./relationshipGraph";
import type { Relationship } from "../state/relationships";

function rel(from: string, to: string): Relationship {
  const [fs, ft, fc] = from.split(".");
  const [ts, tt, tc] = to.split(".");
  return {
    id: Math.abs(hash(from + to)),
    fromSchema: fs, fromTable: ft, fromColumn: fc,
    toSchema: ts, toTable: tt, toColumn: tc,
    cardinality: "many_to_one", reviewed: true,
  };
}
function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// shop: order_item is the junction between orders and product; user joins orders.
const edges: Relationship[] = [
  rel("shop.orders.user_id", "shop.user.id"),
  rel("shop.order_item.order_id", "shop.orders.id"),
  rel("shop.order_item.product_id", "shop.product.id"),
];

describe("connectTables", () => {
  it("pulls the junction table into an M:N pair (orders + product)", () => {
    const r = connectTables(["shop.orders", "shop.product"], edges);
    expect(r.tables).toContain("shop.order_item");
    expect(r.disconnectedPairs).toHaveLength(0);
    // Only the edges among the connected set are returned (the two junction edges).
    expect(r.edges).toHaveLength(2);
  });

  it("connects user↔product across two hops via orders + order_item", () => {
    const r = connectTables(["shop.user", "shop.product"], edges);
    expect(r.tables).toEqual(
      expect.arrayContaining(["shop.user", "shop.orders", "shop.order_item", "shop.product"]),
    );
    expect(r.disconnectedPairs).toHaveLength(0);
  });

  it("reports a disconnected pair when no path exists", () => {
    const r = connectTables(["shop.user", "shop.island"], edges);
    expect(r.disconnectedPairs).toEqual([["shop.user", "shop.island"]]);
    // The island is still passed through (annotate, don't drop).
    expect(r.tables).toContain("shop.island");
  });

  it("does not expand beyond maxHops (no blanket k-hop neighbour drag-in)", () => {
    // user and product are 3 hops apart; with maxHops=1 they stay disconnected
    // and no intermediate tables are pulled in.
    const r = connectTables(["shop.user", "shop.product"], edges, 1);
    expect(r.disconnectedPairs).toHaveLength(1);
    expect(r.tables).not.toContain("shop.order_item");
  });

  it("returns seeds unchanged when there are no relationships", () => {
    const r = connectTables(["a.x", "a.y"], []);
    expect(r.tables.sort()).toEqual(["a.x", "a.y"]);
    expect(r.edges).toHaveLength(0);
    expect(r.disconnectedPairs).toEqual([["a.x", "a.y"]]);
  });
});
