import { describe, it, expect } from "vitest";
import { parseRuleBody, parseRelationshipBody } from "./knowledgeInput";

describe("parseRuleBody", () => {
  it("rejects a bad scope", () => {
    expect(parseRuleBody({ scope: "nope", content: "x" })).toBeTypeOf("string");
  });
  it("rejects empty content", () => {
    expect(parseRuleBody({ scope: "global", content: "   " })).toBeTypeOf("string");
  });
  it("requires a term name for term scope", () => {
    expect(parseRuleBody({ scope: "term", content: "x" })).toBeTypeOf("string");
  });
  it("requires a schema.table for table scope", () => {
    expect(parseRuleBody({ scope: "table", table: "orders", content: "x" })).toBeTypeOf("string");
  });
  it("accepts a valid global rule and trims content", () => {
    const r = parseRuleBody({ scope: "global", content: "  金額是分  ", reviewed: true });
    expect(r).toMatchObject({ scope: "global", content: "金額是分", reviewed: true });
  });
  it("nulls out irrelevant fields per scope", () => {
    const r = parseRuleBody({ scope: "global", termName: "x", content: "c" });
    expect(r).toMatchObject({ termName: null });
  });
});

describe("parseRelationshipBody", () => {
  const valid = {
    fromTable: "shop.orders",
    fromColumn: "user_id",
    toTable: "shop.user",
    toColumn: "id",
    cardinality: "many_to_one",
  };
  it("rejects an unqualified table", () => {
    expect(parseRelationshipBody({ ...valid, fromTable: "orders" })).toBeTypeOf("string");
  });
  it("rejects empty columns", () => {
    expect(parseRelationshipBody({ ...valid, toColumn: "" })).toBeTypeOf("string");
  });
  it("rejects a bad cardinality (many_to_many is not stored)", () => {
    expect(parseRelationshipBody({ ...valid, cardinality: "many_to_many" })).toBeTypeOf("string");
  });
  it("splits schema.table into parts on a valid edge", () => {
    const r = parseRelationshipBody(valid);
    expect(r).toMatchObject({
      fromSchema: "shop", fromTable: "orders", fromColumn: "user_id",
      toSchema: "shop", toTable: "user", toColumn: "id",
      cardinality: "many_to_one",
    });
  });
});
