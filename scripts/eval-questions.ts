import { readFileSync } from "fs";
import { join } from "path";

// 手動載入 .env（scripts 不經 Next，照 test-query-generation.ts 的模式）
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

/**
 * JOIN 可靠性評測（計畫第一波）：docs/eval-questions.json 收真實失敗過的問題，
 * 逐題走完整引擎（檢索→生成→護欄→執行→自我修復），輸出：
 *   stage-1 命中（期望表 ⊆ 實際選表）/ SQL 可執行 / 修復次數。
 * 這是後續每個切片交付後的統一回歸基準——改動前後各跑一次對比。
 */

interface EvalItem {
  question: string;
  expectTables?: string[];
}

async function main() {
  const file = JSON.parse(
    readFileSync(join(process.cwd(), "docs", "eval-questions.json"), "utf-8"),
  ) as { questions: EvalItem[] };
  const items = file.questions ?? [];
  if (items.length === 0) {
    console.log("docs/eval-questions.json 沒有題目——把真實失敗過的問題加進去。");
    process.exit(0);
  }

  const rows: Record<string, unknown>[] = [];
  let okCount = 0;
  let hitCount = 0;
  let repairTotal = 0;

  for (const [i, item] of items.entries()) {
    process.stdout.write(`(${i + 1}/${items.length}) ${item.question}\n`);
    const started = Date.now();
    const result = await runEngine(item.question);
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    const tablesUsed = result.ok ? (result.tablesUsed ?? []) : [];
    const expect = item.expectTables ?? [];
    const stage1Hit = result.ok && expect.every((t) => tablesUsed.includes(t));
    if (result.ok) {
      okCount++;
      repairTotal += result.repaired;
    }
    if (stage1Hit) hitCount++;

    rows.push({
      題目: item.question.slice(0, 30),
      可執行: result.ok ? "✓" : "✗",
      "stage-1命中": expect.length === 0 ? "—" : stage1Hit ? "✓" : "✗",
      資料模型: result.ok ? (result.datasetUsed ?? "—") : "—",
      修復次數: result.ok ? result.repaired : "—",
      耗時s: secs,
      錯誤: result.ok ? "" : result.error.slice(0, 60),
    });
  }

  console.table(rows);
  console.log(
    `可執行 ${okCount}/${items.length}；stage-1 命中 ${hitCount}/${
      items.filter((q) => (q.expectTables ?? []).length > 0).length
    }（有期望表的題目）；總修復次數 ${repairTotal}`,
  );
  process.exit(okCount === items.length ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
