import { describe, expect, it } from "vitest";
import { buildTargets, filterValidProposals, typeFamily } from "./relationshipDiscovery";
import type { ColumnInfo } from "./schema/introspect";
import type { CandidateFkColumn, LearnedRelationship, RelationshipTarget } from "./llm/provider";

function col(table: string, column: string, over: Partial<ColumnInfo> = {}): ColumnInfo {
  return { schema: "mepay", table, column, dataType: "int", columnType: "int", columnKey: "", ...over };
}

describe("typeFamily", () => {
  it("groups int-like and char-like types", () => {
    expect(typeFamily("bigint")).toBe("int");
    expect(typeFamily("VARCHAR")).toBe("char");
    expect(typeFamily("datetime")).toBe("other");
  });
});

describe("buildTargets", () => {
  it("keeps only active tables with a single-column PK", () => {
    const targets = buildTargets(
      [
        col("users", "id", { columnKey: "PRI", dataType: "bigint" }),
        col("users", "name", { dataType: "varchar" }),
        col("order_item", "order_id", { columnKey: "PRI" }), // composite PK
        col("order_item", "product_id", { columnKey: "PRI" }),
        col("logs", "id", { columnKey: "PRI" }), // excluded table
      ],
      new Set(["mepay.users", "mepay.order_item"]),
    );
    expect(targets).toEqual([{ table: "mepay.users", pkColumn: "id", pkType: "bigint" }]);
  });
});

describe("filterValidProposals", () => {
  const candidates: CandidateFkColumn[] = [
    { table: "mepay.orders", column: "buyer_uid", dataType: "bigint", sampleValues: [] },
  ];
  const targets: RelationshipTarget[] = [
    { table: "mepay.users", pkColumn: "id", pkType: "bigint" },
  ];
  const good: LearnedRelationship = {
    fromTable: "mepay.orders",
    fromColumn: "buyer_uid",
    toTable: "mepay.users",
    toColumn: "whatever_the_model_said",
    cardinality: "many_to_one",
  };

  it("forces toColumn to the target's real PK", () => {
    const out = filterValidProposals([good], candidates, targets);
    expect(out).toHaveLength(1);
    expect(out[0].toColumn).toBe("id");
  });

  it("drops proposals whose from-side wasn't offered", () => {
    const out = filterValidProposals(
      [{ ...good, fromColumn: "invented_col" }],
      candidates,
      targets,
    );
    expect(out).toEqual([]);
  });

  it("drops proposals to a non-whitelisted target and self-references", () => {
    expect(
      filterValidProposals([{ ...good, toTable: "mepay.hallucinated" }], candidates, targets),
    ).toEqual([]);
    expect(
      filterValidProposals(
        [{ ...good, toTable: "mepay.orders" }],
        candidates,
        [...targets, { table: "mepay.orders", pkColumn: "id", pkType: "bigint" }],
      ),
    ).toEqual([]);
  });

  it("keeps only the first proposal per candidate column", () => {
    const out = filterValidProposals(
      [good, { ...good, cardinality: "one_to_one" }],
      candidates,
      targets,
    );
    expect(out).toHaveLength(1);
    expect(out[0].cardinality).toBe("many_to_one");
  });
});
