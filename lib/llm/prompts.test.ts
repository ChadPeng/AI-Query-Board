import { describe, it, expect } from "vitest";
import {
  formatRules,
  formatRelationships,
  buildSqlUserPrompt,
  buildSelectUserPrompt,
} from "./prompts";
import type { InjectedRule, InjectedRelationship } from "./provider";

const termRule: InjectedRule = {
  scope: "term",
  termName: "創作者",
  content: "user 表中 is_creator=1 的人",
  reviewed: true,
};
const globalRuleDraft: InjectedRule = {
  scope: "global",
  content: "金額單位是分",
  reviewed: false,
};
const tableRule: InjectedRule = {
  scope: "table",
  table: "shop.orders",
  content: "status 3=已出貨",
  reviewed: true,
};

describe("formatRules", () => {
  it("returns empty string for no rules", () => {
    expect(formatRules(undefined)).toBe("");
    expect(formatRules([])).toBe("");
  });

  it("formats term/global/table scopes distinctly", () => {
    const out = formatRules([termRule, globalRuleDraft, tableRule]);
    expect(out).toContain("「創作者」");
    expect(out).toContain("(shop.orders)");
    expect(out).toContain("金額單位是分");
  });

  it("marks only un-reviewed rules as unconfirmed", () => {
    const out = formatRules([termRule, globalRuleDraft]);
    // the draft line carries the marker, the reviewed one does not
    const draftLine = out.split("\n").find((l) => l.includes("金額單位是分"))!;
    const termLine = out.split("\n").find((l) => l.includes("創作者"))!;
    expect(draftLine).toContain("（未確認）");
    expect(termLine).not.toContain("（未確認）");
  });
});

const edge: InjectedRelationship = {
  fromTable: "shop.orders",
  fromColumn: "user_id",
  toTable: "shop.user",
  toColumn: "id",
  cardinality: "many_to_one",
  reviewed: false,
};

describe("formatRelationships", () => {
  it("renders the edge with cardinality and an unconfirmed marker", () => {
    const out = formatRelationships([edge]);
    expect(out).toContain("shop.orders");
    expect(out).toContain("shop.user");
    expect(out).toContain("多對一");
    expect(out).toContain("（未確認）");
  });
});

describe("buildSqlUserPrompt", () => {
  it("includes DDL, rules, relationships and the disconnected note", () => {
    const p = buildSqlUserPrompt({
      question: "當月賣最好的創作者",
      schemaDDL: "CREATE TABLE shop.orders (...)",
      rules: [termRule, tableRule],
      relationships: [edge],
      disconnectedPairs: [["shop.a", "shop.b"]],
    });
    expect(p).toContain("CREATE TABLE shop.orders");
    expect(p).toContain("Semantic rules");
    expect(p).toContain("Table relationships");
    expect(p).toContain("shop.a ↔ shop.b");
    expect(p).toContain("當月賣最好的創作者");
  });

  it("omits the semantic sections when there is nothing to inject", () => {
    const p = buildSqlUserPrompt({ question: "q", schemaDDL: "DDL" });
    expect(p).not.toContain("Semantic rules");
    expect(p).not.toContain("Table relationships");
    expect(p).not.toContain("no known relationship");
  });
});

describe("buildSelectUserPrompt", () => {
  it("appends always-injected rules so they can steer table selection", () => {
    const p = buildSelectUserPrompt({
      question: "創作者銷售",
      catalog: [{ table: "shop.user", description: "使用者" }],
      rules: [termRule],
    });
    expect(p).toContain("shop.user: 使用者");
    expect(p).toContain("「創作者」");
    expect(p).toContain("Question: 創作者銷售");
  });
});
