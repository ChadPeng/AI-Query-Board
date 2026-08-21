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
import { createDataset, deleteDataset, getDatasetModel, listDatasets } from "../lib/state/datasets";
import { runGuardedQuery } from "../lib/analytics/execute";

/**
 * 情境二：Dataset 確定性管線（零 LLM，真 DB）。
 * 覆蓋：模型驗證、活體探測（含故意壞欄位）、編譯器輸出、
 * 「編譯結果 vs 手寫 SQL」數字交叉比對、JOIN 剪枝與多跳 JOIN、
 * prepared-statement 注入防護、負面案例（星型違規、佔位符、上限夾制）。
 */

interface Check {
  id: string;
  name: string;
  pass: boolean;
  evidence: string;
}

const checks: Check[] = [];
function check(id: string, name: string, pass: boolean, evidence: string) {
  checks.push({ id, name, pass, evidence });
  console.log(`${pass ? "✓" : "✗"} [${id}] ${name}`);
}

async function main() {
  // ── 1. 載入示範模型 ────────────────────────────────────────────
  const demo = (await listDatasets(false)).find((d) => d.name === "訂單分析");
  if (!demo) throw new Error("找不到「訂單分析」模型，先跑 scripts/seed-demo-dataset.ts");
  const model = (await getDatasetModel(demo.id))!;
  const f = (name: string) => model.fields.find((x) => x.name === name)!;

  // ── 2. 正確性交叉比對：編譯結果 vs 手寫 SQL ───────────────────
  const compiled = compileExplorerQuery(model, {
    dimensions: [{ fieldId: f("月份").id!, dateBucket: "month" }],
    measures: [{ fieldId: f("營收").id! }, { fieldId: f("訂單數").id! }],
    filters: [{ fieldId: f("月份").id!, op: "between", values: ["2026-01-01", "2026-06-30"] }],
    limit: 12,
  });
  const compiledRows = (await runGuardedQuery(compiled.sql, { values: compiled.values })).rows;
  const handRows = (
    await runGuardedQuery(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
              SUM(CASE WHEN status = 4 THEN total END) AS rev,
              COUNT(*) AS cnt
         FROM mepay.orders
        WHERE created_at BETWEEN ? AND ?
        GROUP BY m ORDER BY m ASC LIMIT 12`,
      { values: ["2026-01-01", "2026-06-30"] },
    )
  ).rows;
  const same =
    compiledRows.length === handRows.length &&
    compiledRows.every(
      (r, i) =>
        String(r["月份"]) === String(handRows[i].m) &&
        String(r["營收"]) === String(handRows[i].rev) &&
        String(r["訂單數"]) === String(handRows[i].cnt),
    );
  check(
    "S2-1",
    "編譯結果與手寫 SQL 逐列數字一致（2026 上半年月營收＋訂單數）",
    same,
    `編譯 ${compiledRows.length} 列 vs 手寫 ${handRows.length} 列；首列 ${JSON.stringify(compiledRows[0])}`,
  );

  // ── 3. TOP-N＋暱稱維度（走 JOIN）＋度量排序 ──────────────────
  const top = compileExplorerQuery(model, {
    dimensions: [{ fieldId: f("使用者暱稱").id! }],
    measures: [{ fieldId: f("營收").id! }],
    filters: [{ fieldId: f("月份").id!, op: "between", values: ["2026-06-01", "2026-06-30 23:59:59"] }],
    sort: { by: 0, dir: "desc" },
    limit: 10,
  });
  const topRows = (await runGuardedQuery(top.sql, { values: top.values })).rows;
  check(
    "S2-2",
    "暱稱維度（LEFT JOIN user_profiles）＋依營收排序 TOP10 可執行",
    top.sql.includes("LEFT JOIN `mepay`.`user_profiles`") && topRows.length > 0 && topRows.length <= 10,
    `回傳 ${topRows.length} 列；第一名 ${JSON.stringify(topRows[0])}`,
  );

  // ── 4. JOIN 剪枝：不用暱稱時不 JOIN ──────────────────────────
  check(
    "S2-3",
    "JOIN 剪枝：查詢沒碰 user_profiles 時 SQL 不含 LEFT JOIN",
    !compiled.sql.includes("LEFT JOIN"),
    compiled.sql.split("\n").slice(0, 3).join(" ⏎ "),
  );

  // ── 5. 注入防護：惡意篩選值只是資料 ──────────────────────────
  const inj = compileExplorerQuery(model, {
    dimensions: [{ fieldId: f("使用者暱稱").id! }],
    measures: [{ fieldId: f("訂單數").id! }],
    filters: [
      { fieldId: f("使用者暱稱").id!, op: "eq", values: ["x'; DROP TABLE mepay.orders; --"] },
      { fieldId: f("訂單狀態").id!, op: "in", values: ["4' OR '1'='1", "5"] },
    ],
  });
  const injRows = (await runGuardedQuery(inj.sql, { values: inj.values })).rows;
  check(
    "S2-4",
    "注入攻擊字串經 ? 綁定後只是普通資料（不報錯、不出事，回 0 列）",
    inj.sql.includes("= ?") && inj.sql.includes("IN (?, ?)") && injRows.length === 0,
    `values=${JSON.stringify(inj.values)}；回傳 ${injRows.length} 列`,
  );

  // ── 6. 負面：星型違規／佔位符／上限 ──────────────────────────
  const offBase = validateDatasetModel({
    tables: model.tables,
    fields: [{ ...f("營收"), tableAlias: "up" }],
  });
  check("S2-5", "度量放在非基底表 → 驗證擋下（星型限制）", offBase.some((e) => e.includes("基底表")), offBase.join("；"));

  const badCond = validateDatasetModel({
    tables: model.tables,
    fields: [{ ...f("營收"), conditionSql: "o.status = :s" }],
  });
  check("S2-6", "口徑條件含佔位符 → 驗證擋下", badCond.some((e) => e.includes("佔位符")), badCond.join("；"));

  const clamp = compileExplorerQuery(model, {
    dimensions: [{ fieldId: f("月份").id!, dateBucket: "year" }],
    measures: [{ fieldId: f("訂單數").id! }],
    filters: [],
    limit: 999999,
  });
  check("S2-7", "limit 999999 → 夾制為 5000", clamp.sql.trim().endsWith("LIMIT 5000"), clamp.sql.split("\n").pop() ?? "");

  // ── 7. 活體探測抓壞欄位 ──────────────────────────────────────
  const badInput: DatasetInput = {
    name: "壞模型測試",
    description: null,
    published: false,
    tables: model.tables,
    fields: [{ ...f("營收"), id: undefined, name: "壞欄位", columnName: "no_such_column" }],
  };
  const probeError = await probeDatasetInput(badInput);
  check(
    "S2-8",
    "儲存時活體探測抓到不存在的欄位（MySQL 錯誤變成表單訊息）",
    probeError != null && probeError.includes("no_such_column"),
    probeError ?? "(沒抓到)",
  );

  // ── 8. 臨時多跳模型：o→up→u 兩跳鏈 ───────────────────────────
  const multiHop: DatasetInput = {
    name: "測試_多跳鏈",
    description: "情境二臨時模型，測完即刪",
    published: false,
    tables: [
      { alias: "o", schema: "mepay", table: "orders", parentAlias: null, parentColumn: null, childColumn: null, cardinality: null, relationshipId: null },
      { alias: "up", schema: "mepay", table: "user_profiles", parentAlias: "o", parentColumn: "user_id", childColumn: "user_id", cardinality: "many_to_one", relationshipId: null },
      { alias: "u", schema: "mepay", table: "users", parentAlias: "up", parentColumn: "user_id", childColumn: "id", cardinality: "many_to_one", relationshipId: null },
    ],
    fields: [
      { kind: "dimension", name: "是否創作者", description: null, tableAlias: "u", columnName: "is_creator", dataType: "int", aggregation: null, conditionSql: null, sortOrder: 0 },
      { kind: "measure", name: "訂單數", description: null, tableAlias: "o", columnName: null, dataType: null, aggregation: "count", conditionSql: null, sortOrder: 1 },
    ],
  };
  const mhProbe = await probeDatasetInput(multiHop);
  check("S2-9", "多跳模型（o→up→u）活體探測通過", mhProbe === null, mhProbe ?? "OK");
  let mhId = 0;
  try {
    mhId = await createDataset(1, multiHop);
    const mhModel = (await getDatasetModel(mhId))!;
    const mf = (n: string) => mhModel.fields.find((x) => x.name === n)!;
    const mh = compileExplorerQuery(mhModel, {
      dimensions: [{ fieldId: mf("是否創作者").id! }],
      measures: [{ fieldId: mf("訂單數").id! }],
      filters: [],
    });
    const mhRows = (await runGuardedQuery(mh.sql, { values: mh.values })).rows;
    check(
      "S2-10",
      "兩跳 JOIN 鏈正確展開（o→up→u）且可執行",
      mh.sql.includes("LEFT JOIN `mepay`.`user_profiles`") &&
        mh.sql.includes("LEFT JOIN `mepay`.`users`") &&
        mhRows.length > 0,
      `SQL 兩條 LEFT JOIN；分組結果 ${JSON.stringify(mhRows)}`,
    );
  } finally {
    if (mhId) {
      await deleteDataset(mhId);
      check("S2-11", "臨時模型已清除（不留在系統中）", (await getDatasetModel(mhId)) === null, `id=${mhId} 已刪除`);
    }
  }

  const passed = checks.filter((c) => c.pass).length;
  console.log("===JSON===");
  console.log(JSON.stringify({ checks, passed, total: checks.length }, null, 2));
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
