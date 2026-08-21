import { describe, expect, it } from "vitest";
import { pickFewShotExamples } from "./fewshot";

const TABLES = ["mepay.orders", "mepay.user_profiles"];
const REVENUE = {
  question: "給我2026/06的訂單營收TOP10的使用者排行榜",
  sql: "SELECT up.nickname, SUM(o.total) FROM mepay.orders o JOIN mepay.user_profiles up ON o.user_id = up.user_id WHERE o.status = 4 GROUP BY up.nickname",
};
const MCOIN = {
  question: "2026獲得最多MCOIN的使用者TOP10",
  sql: "SELECT up.nickname, SUM(l.amount) FROM mepay.mcoin_logs l JOIN mepay.user_profiles up ON l.user_id = up.user_id GROUP BY up.nickname",
};

describe("pickFewShotExamples", () => {
  it("picks a paraphrase of a saved question (tables + keywords overlap)", () => {
    const picked = pickFewShotExamples("六月訂單營收最高的十個使用者", TABLES, [REVENUE, MCOIN]);
    expect(picked[0]).toEqual(REVENUE);
  });

  it("rejects table-overlap-only matches when no keyword overlaps（情境三發現）", () => {
    // 「性別分佈」與營收/MCOIN 問題毫無關鍵詞交集——即使 SQL 都碰 user_profiles 也不該入選
    const picked = pickFewShotExamples("會員性別統計", TABLES, [REVENUE, MCOIN]);
    expect(picked).toEqual([]);
  });

  it("never leaks the identical question back as its own example", () => {
    const picked = pickFewShotExamples(REVENUE.question, TABLES, [REVENUE]);
    expect(picked).toEqual([]);
  });

  it("caps at two examples and respects the char budget", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      question: `訂單營收統計第${i}版`,
      sql: REVENUE.sql,
    }));
    const picked = pickFewShotExamples("訂單營收統計", TABLES, many);
    expect(picked.length).toBeLessThanOrEqual(2);

    const huge = { question: "訂單營收統計加長版", sql: "SELECT 1 FROM mepay.orders -- " + "x".repeat(2000) };
    expect(pickFewShotExamples("訂單營收統計", TABLES, [huge])).toEqual([]);
  });

  it("returns nothing when stage-1 selected no tables", () => {
    expect(pickFewShotExamples("訂單營收", [], [REVENUE])).toEqual([]);
  });
});
