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

import type { DatasetInput } from "../lib/datasets/types";
import { validateDatasetModel } from "../lib/datasets/validate";
import { probeDatasetInput } from "../lib/datasets/probe";
import { compileExplorerQuery } from "../lib/datasets/compile";
import { createDataset, getDatasetModel, listDatasets, updateDataset } from "../lib/state/datasets";
import { runGuardedQuery } from "../lib/analytics/execute";

/**
 * 種子＋煙霧驗證：建立「訂單分析」示範資料模型（已存在則沿用），
 * 然後編譯一個 ExplorerQuery 對真實分析庫執行，驗證整條確定性管線。
 * 用法：npx tsx scripts/seed-demo-dataset.ts
 */

const DEMO: DatasetInput = {
  name: "訂單分析",
  description: "訂單相關問題：營收、訂單數、按月/按使用者/按商店分析。基底表 orders，可帶出使用者暱稱與商店名稱。",
  published: true,
  tables: [
    {
      alias: "o",
      schema: "mepay",
      table: "orders",
      parentAlias: null,
      parentColumn: null,
      childColumn: null,
      cardinality: null,
      relationshipId: null,
    },
    {
      alias: "up",
      schema: "mepay",
      table: "user_profiles",
      parentAlias: "o",
      parentColumn: "user_id",
      childColumn: "user_id",
      cardinality: "many_to_one",
      relationshipId: null,
    },
    // 情境測試建議 1：補商店維度（orders.shop_id → shops.id，值重疊 100%，
    // 對應語意層已校對的關係邊 id=191），讓「各商店…」給得出商店名稱。
    {
      alias: "s",
      schema: "mepay",
      table: "shops",
      parentAlias: "o",
      parentColumn: "shop_id",
      childColumn: "id",
      cardinality: "many_to_one",
      relationshipId: 191,
    },
  ],
  fields: [
    { kind: "dimension", name: "月份", description: "訂單建立月份", tableAlias: "o", columnName: "created_at", dataType: "datetime", aggregation: null, conditionSql: null, sortOrder: 0 },
    { kind: "dimension", name: "使用者暱稱", description: null, tableAlias: "up", columnName: "nickname", dataType: "varchar", aggregation: null, conditionSql: null, sortOrder: 1 },
    { kind: "dimension", name: "商店名稱", description: null, tableAlias: "s", columnName: "name", dataType: "varchar", aggregation: null, conditionSql: null, sortOrder: 2 },
    { kind: "dimension", name: "訂單狀態", description: "0待付款 1排隊 2服務中 3洽客服 4完成 5取消 6退款", tableAlias: "o", columnName: "status", dataType: "int", aggregation: null, conditionSql: null, sortOrder: 3 },
    { kind: "measure", name: "營收", description: "已完成訂單的金額加總", tableAlias: "o", columnName: "total", dataType: "decimal", aggregation: "sum", conditionSql: "o.status = 4", sortOrder: 4 },
    { kind: "measure", name: "訂單數", description: null, tableAlias: "o", columnName: null, dataType: null, aggregation: "count", conditionSql: null, sortOrder: 5 },
    { kind: "measure", name: "完成訂單數", description: null, tableAlias: "o", columnName: null, dataType: null, aggregation: "count", conditionSql: "o.status = 4", sortOrder: 6 },
  ],
};

async function main() {
  const violations = validateDatasetModel(DEMO);
  if (violations.length > 0) {
    console.error("模型定義不合法：", violations);
    process.exit(1);
  }

  console.log("→ 對真實分析庫探測欄位與口徑條件…");
  const probeError = await probeDatasetInput(DEMO);
  if (probeError) {
    console.error("探測失敗：", probeError);
    process.exit(1);
  }
  console.log("✓ 欄位與 JOIN 驗證通過");

  const existing = (await listDatasets(false)).find((d) => d.name === DEMO.name);
  let id: number;
  if (existing) {
    await updateDataset(existing.id, DEMO);
    id = existing.id;
    console.log(`✓ 模型已存在（id=${id}），已更新為最新定義`);
  } else {
    id = await createDataset(1, DEMO);
    console.log(`✓ 已建立模型（id=${id}）`);
  }

  const model = (await getDatasetModel(id))!;
  const monthDim = model.fields.find((f) => f.name === "月份")!;
  const revenue = model.fields.find((f) => f.name === "營收")!;
  const orders = model.fields.find((f) => f.name === "訂單數")!;

  const compiled = compileExplorerQuery(model, {
    dimensions: [{ fieldId: monthDim.id!, dateBucket: "month" }],
    measures: [{ fieldId: revenue.id! }, { fieldId: orders.id! }],
    filters: [{ fieldId: monthDim.id!, op: "gte", values: ["2026-01-01"] }],
    limit: 24,
  });
  console.log("\n=== 編譯出的 SQL ===\n" + compiled.sql);
  console.log("綁定值：", compiled.values);

  const result = await runGuardedQuery(compiled.sql, { values: compiled.values });
  console.log(`\n=== 執行結果（${result.rows.length} 列）===`);
  console.table(result.rows.slice(0, 12));
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
