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

import { runEngine } from "../lib/engine";
import { getRecentFailureStats } from "../lib/state/queryFailures";

/**
 * 情境一：AI 自然語言查詢全流程（真 DB + 真 LLM）。
 * 覆蓋：dataset-first 路由、兩階段檢索＋圖連通、新發現關係邊的多跳 JOIN、
 * 業務術語規則、追問（history）、無關問題的挑表 fallback、失敗遙測。
 * 用 userId=1（admin）跑，讓 trusted-query 重用與 few-shot 都在真實條件下參與。
 */

interface CaseResult {
  id: string;
  question: string;
  note: string;
  ok: boolean;
  fromSaved?: boolean;
  datasetUsed?: string;
  tablesUsed?: string[];
  repaired?: number;
  warnings?: string[];
  rowCount?: number;
  sampleRows?: Record<string, unknown>[];
  chartType?: string;
  sql?: string;
  error?: string;
  elapsedS: string;
}

async function runCase(
  id: string,
  question: string,
  note: string,
  history: { question: string; sql: string }[] = [],
): Promise<CaseResult> {
  const started = Date.now();
  const r = await runEngine(question, { userId: 1, history });
  const elapsedS = ((Date.now() - started) / 1000).toFixed(1);
  if (r.ok) {
    return {
      id, question, note, ok: true,
      fromSaved: r.fromSaved,
      datasetUsed: r.datasetUsed,
      tablesUsed: r.tablesUsed,
      repaired: r.repaired,
      warnings: r.warnings,
      rowCount: r.rows.length,
      sampleRows: r.rows.slice(0, 3),
      chartType: r.chartSpec.chart_type,
      sql: r.sql,
      elapsedS,
    };
  }
  return { id, question, note, ok: false, error: r.error, sql: r.sql, elapsedS };
}

async function main() {
  const results: CaseResult[] = [];

  results.push(await runCase("S1-1", "給我2026/06的訂單營收TOP10的使用者排行榜", "預期命中資料模型「訂單分析」"));
  results.push(await runCase("S1-2", "最近30天每天的完成訂單數趨勢", "預期命中資料模型、時間序列"));
  results.push(await runCase("S1-3", "2026年每月營收與訂單數", "預期命中資料模型、雙度量"));
  results.push(await runCase("S1-4", "2026年7月各商店訂單數前10名", "商店維度不在模型內——看系統怎麼處理"));
  results.push(await runCase("S1-5", "列出20位創作者的暱稱", "考「創作者=is_creator=1」術語規則＋兩階段檢索"));
  results.push(await runCase("S1-6", "骰子活動參與次數最多的前10位使用者", "考今天剛由關係發現寫入的 dice_logs→users 草稿邊（多跳 JOIN）"));

  // S1-7：追問——先問 S1-3，再帶 history 追問
  const base = results.find((r) => r.id === "S1-3");
  results.push(
    await runCase(
      "S1-7",
      "改成只看退款的訂單",
      "追問（帶對話歷史，改過濾條件）",
      base?.sql ? [{ question: base.question, sql: base.sql }] : [],
    ),
  );

  results.push(await runCase("S1-8", "請問明天台北的天氣如何", "無關問題——預期優雅拒絕（挑不到表）"));

  const failures = await getRecentFailureStats(1);

  console.log("===JSON===");
  console.log(JSON.stringify({ results, failuresLast24h: failures }, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
