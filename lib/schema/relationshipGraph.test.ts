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
    expect(r.paths).toEqual([]);
  });

  it("keeps the walked path as ordered JOIN steps with the joining columns", () => {
    const r = connectTables(["shop.user", "shop.product"], edges);
    expect(r.paths).toHaveLength(1);
    const { seedPair, steps } = r.paths[0];
    expect(seedPair).toEqual(["shop.user", "shop.product"]);
    // user → orders → order_item → product, each step oriented along the path
    // with the columns of the (possibly reversed) stored edge.
    expect(steps).toEqual([
      { fromTable: "shop.user", fromColumn: "id", toTable: "shop.orders", toColumn: "user_id", reviewed: true },
      { fromTable: "shop.orders", fromColumn: "id", toTable: "shop.order_item", toColumn: "order_id", reviewed: true },
      { fromTable: "shop.order_item", fromColumn: "product_id", toTable: "shop.product", toColumn: "id", reviewed: true },
    ]);
  });

  it("drops a shorter path fully contained in a longer kept one", () => {
    // Seeds user + orders + product: the user↔orders path is a prefix of the
    // user↔product chain — only the long chain should render.
    const r = connectTables(["shop.user", "shop.orders", "shop.product"], edges);
    const chains = r.paths.map((p) => p.steps.length);
    expect(Math.max(...chains)).toBe(3);
    for (const p of r.paths) {
      if (p.steps.length === 1) {
        // any surviving single-hop must not be a hop of the long chain
        const long = r.paths.find((q) => q.steps.length === 3)!;
        const longKeys = long.steps.map((s) => `${s.fromTable}>${s.toTable}`);
        expect(longKeys).not.toContain(`${p.steps[0].fromTable}>${p.steps[0].toTable}`);
      }
    }
  });

  it("prefers a reviewed edge when several connect the same pair", () => {
    const draft = { ...rel("shop.orders.legacy_uid", "shop.user.id"), reviewed: false };
    const r = connectTables(["shop.orders", "shop.user"], [draft, edges[0]]);
    expect(r.paths[0].steps[0]).toMatchObject({ fromColumn: "user_id", reviewed: true });
  });
});
