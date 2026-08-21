import { describe, expect, it } from "vitest";
import { keywordScore, tokenize, tokenOverlap } from "./keywordScore";

describe("tokenize", () => {
  it("extracts ASCII words and CJK bigrams from mixed text", () => {
    const tokens = tokenize("2026/06的訂單營收TOP10");
    expect(tokens).toContain("2026");
    expect(tokens).toContain("top10");
    expect(tokens).toContain("訂單");
    expect(tokens).toContain("營收");
    // bigrams cross word boundaries inside a CJK run
    expect(tokens).toContain("單營");
  });

  it("keeps a lone CJK character", () => {
    expect(tokenize("查 表")).toEqual(expect.arrayContaining(["查", "表"]));
  });
});

describe("keywordScore", () => {
  const q = tokenize("訂單營收 orders");

  it("weights table-name hits double vs description hits", () => {
    const nameHit = keywordScore(q, "mepay.orders", "");
    const descHit = keywordScore(q, "mepay.foo", "存放訂單資料");
    expect(nameHit).toBe(2);
    expect(descHit).toBeGreaterThanOrEqual(1);
    expect(nameHit).toBeGreaterThan(0);
  });

  it("scores zero when nothing overlaps", () => {
    expect(keywordScore(tokenize("會員等級"), "mepay.shipments", "物流出貨")).toBe(0);
  });
});

describe("tokenOverlap", () => {
  it("counts shared tokens between two questions", () => {
    expect(tokenOverlap("本月訂單營收", "上月訂單營收")).toBeGreaterThanOrEqual(3);
    expect(tokenOverlap("會員名單", "物流狀態")).toBe(0);
  });
});
