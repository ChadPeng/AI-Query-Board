import { describe, it, expect } from "vitest";
import { coerceLearnResult } from "./prompts";

describe("coerceLearnResult", () => {
  it("returns empty arrays for junk input", () => {
    expect(coerceLearnResult(null)).toEqual({ relationships: [], rules: [] });
    expect(coerceLearnResult({})).toEqual({ relationships: [], rules: [] });
    expect(coerceLearnResult({ relationships: "nope", rules: 5 })).toEqual({
      relationships: [],
      rules: [],
    });
  });

  it("keeps well-formed relationships and drops bad cardinality / empty fields", () => {
    const out = coerceLearnResult({
      relationships: [
        { fromTable: "s.orders", fromColumn: "user_id", toTable: "s.user", toColumn: "id", cardinality: "many_to_one" },
        { fromTable: "s.a", fromColumn: "b", toTable: "s.c", toColumn: "d", cardinality: "many_to_many" }, // bad card
        { fromTable: "s.a", fromColumn: "", toTable: "s.c", toColumn: "d", cardinality: "many_to_one" }, // empty col
      ],
      rules: [],
    });
    expect(out.relationships).toHaveLength(1);
    expect(out.relationships[0].toTable).toBe("s.user");
  });

  it("keeps valid rules, trims, and drops bad scope / empty content", () => {
    const out = coerceLearnResult({
      relationships: [],
      rules: [
        { scope: "term", termName: " 創作者 ", table: null, content: " is_creator=1 " },
        { scope: "table", termName: null, table: "s.orders", content: "status=3 已出貨" },
        { scope: "nope", content: "x" }, // bad scope
        { scope: "global", content: "   " }, // empty content
      ],
    });
    expect(out.rules).toHaveLength(2);
    expect(out.rules[0]).toMatchObject({ scope: "term", termName: "創作者", content: "is_creator=1" });
  });
});
