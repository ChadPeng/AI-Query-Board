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

import { createProvider } from "../lib/llm/factory";
import { discoverRelationships } from "../lib/relationshipDiscovery";

/**
 * LLM 輔助關係發現（第二波）。用法：
 *   npm run discover:relationships -- [--dry-run] [--limit=20] [--batch-size=5]
 * 「/knowledge 健檢面板的疑似外鍵缺口」就是這支的工作清單；只處理尚無邊的欄位，
 * 重跑天然可續傳。提案經值重疊探測 ≥80% 才寫入 reviewed=0 草稿。
 */

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limit = flag("limit") ? Number(flag("limit")) : undefined;
  const batchSize = flag("batch-size") ? Number(flag("batch-size")) : undefined;

  const provider = createProvider();
  const report = await discoverRelationships(provider, {
    dryRun,
    limit,
    batchSize,
    log: (m) => console.log(m),
  });

  console.log("");
  console.table(
    report.proposals.map((p) => ({
      來源: `${p.fromTable}.${p.fromColumn}`,
      目標: `${p.toTable}.${p.toColumn}`,
      基數: p.cardinality,
      重疊率: p.matchRate === null ? "—" : `${(p.matchRate * 100).toFixed(0)}%`,
      結果: p.action,
    })),
  );
  console.log(
    `考慮 ${report.candidatesConsidered} 個候選欄位；提案 ${report.proposals.length} 條；` +
      `寫入草稿 ${report.created} 條${dryRun ? "（dry-run，未寫入）" : ""}。` +
      `到 /knowledge 關係分頁校對黃底草稿。`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
