import { readFileSync } from "fs";
import { join } from "path";

// 手動載入 .env（scripts 不經 Next）
const envFile = readFileSync(join(process.cwd(), ".env"), "utf-8");
envFile.split("\n").forEach((line) => {
  const match = line.match(/^([^=:#]+)=(.*)$/);
  if (match) {
    const key = match[1].trim();
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
});

import type { RowDataPacket } from "mysql2/promise";
import { statePool } from "../lib/db";
import { getCatalog } from "../lib/state/catalog";
import { listRelationships } from "../lib/state/relationships";
import { listRules } from "../lib/state/semanticRules";
import { listColumnsInSchemas } from "../lib/schema/introspect";
import { computeCoverage, type CoverageStats } from "../lib/schema/coverage";
import { getRecentFailureStats } from "../lib/state/queryFailures";
import { listSavedQueryExamples } from "../lib/state/savedQueries";
import { pickFewShotExamples } from "../lib/fewshot";
import { discoverRelationships } from "../lib/relationshipDiscovery";
import { createProvider } from "../lib/llm/factory";

/**
 * 情境三：知識庫飛輪（真 DB + 真 LLM）。
 * 覆蓋：健檢覆蓋率（前後對比）、關係發現實跑一輪（值重疊裁決）、
 * few-shot 從真實可信查詢挑示範、失敗遙測統計。
 */

async function coverage(): Promise<CoverageStats> {
  const [catalog, relationships, rules] = await Promise.all([
    getCatalog(),
    listRelationships(),
    listRules(),
  ]);
  const schemas = [...new Set(catalog.map((c) => c.schema))];
  const columns = await listColumnsInSchemas(schemas);
  return computeCoverage(catalog, relationships, rules, columns, true);
}

function summarize(s: CoverageStats) {
  return {
    表總數: s.catalog.total,
    有描述: s.catalog.described,
    已排除: s.catalog.excluded,
    關係邊: s.relationships.total,
    已校對邊: s.relationships.reviewed,
    有邊的表: s.relationships.tablesWithEdges,
    連通區塊: s.graph.componentCount,
    最大區塊: s.graph.largestComponent,
    孤島表: s.graph.isolatedTables.length,
    外鍵缺口: s.fkGaps.length,
  };
}

async function main() {
  // ── 1. 覆蓋率（發現前） ─────────────────────────────────────
  const before = await coverage();
  console.log("發現前：", JSON.stringify(summarize(before)));

  // ── 2. 關係發現實跑（下一批 30 張來源表） ────────────────────
  const provider = createProvider();
  const report = await discoverRelationships(provider, {
    limit: 30,
    log: (m) => console.log("  " + m),
  });

  // ── 3. 覆蓋率（發現後） ─────────────────────────────────────
  const after = await coverage();
  console.log("發現後：", JSON.stringify(summarize(after)));

  // ── 4. few-shot：對真實可信查詢做相似度挑選 ──────────────────
  const pool = statePool()!;
  const [savedRows] = (await pool.query(
    `SELECT user_id, COUNT(*) AS n FROM saved_query GROUP BY user_id ORDER BY n DESC LIMIT 1`,
  )) as [RowDataPacket[], unknown];
  const topUser = savedRows[0] ? Number(savedRows[0].user_id) : 1;
  const examplesPool = await listSavedQueryExamples(topUser);
  const fewshotCases = [
    "幫我看六月訂單營收最高的十個使用者",
    "會員的性別分佈",
  ].map((q) => ({
    question: q,
    picked: pickFewShotExamples(q, ["mepay.orders", "mepay.user_profiles"], examplesPool).map(
      (e) => e.question,
    ),
  }));

  // ── 5. 失敗遙測 ─────────────────────────────────────────────
  const failures = await getRecentFailureStats(7);

  console.log("===JSON===");
  console.log(
    JSON.stringify(
      {
        before: summarize(before),
        discovery: {
          candidatesConsidered: report.candidatesConsidered,
          proposals: report.proposals,
          created: report.created,
        },
        after: summarize(after),
        fewshot: { savedQueriesOfUser: examplesPool.length, userId: topUser, cases: fewshotCases },
        failuresLast7d: failures,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
