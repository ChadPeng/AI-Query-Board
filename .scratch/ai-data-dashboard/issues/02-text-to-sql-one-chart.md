# 02 — 端到端 text-to-SQL → 一張圖（核心 tracer bullet）

Status: done

> Completed 2026-06-22. `LLMProvider` interface (lib/llm/provider.ts) + `ClaudeProvider`
> (claude-sonnet-4-6, overridable via ANTHROPIC_MODEL) using `messages.parse` +
> `zodOutputFormat` structured output → `{sql, chart_spec, explanation}`. Engine
> (lib/engine.ts): read-only guard → execute against analytics pool → field-validation
> repair loop (1 round) → EngineResult. ECharts component (deterministic spec→option,
> bar/line/area/pie + table fallback) renders on the left with the SQL shown beside it.
> Shared `ChartSpec` type (lib/llm/types.ts). typecheck + build pass; graceful-degradation
> path verified (no key → friendly ok:false). NOTE: live Claude + live MySQL path not
> exercised here (no API key / DB in this env) — verify after setting ANTHROPIC_API_KEY
> and ANALYTICS_DB_*. Schema fed from lib/schema/sampleSchema.ts (hand-picked; slice 03
> replaces with retrieval).

Source: `.scratch/ai-data-dashboard/PRD.md`（里程碑 2、第 3 節）

## What to build

整個產品的心臟：使用者輸入一個數據問題，系統產生 SQL、查詢唯讀分析庫、並渲染**一張**圖表。

行為流程：
1. 問句送進後端，呼叫 Claude（經 `LLMProvider` 介面，`claude-sonnet-4-6` 起步）。
2. 模型用 **structured output** 一次回傳 `{ sql, chart_spec }`。
3. 對唯讀分析庫執行 SQL，取回結果列。
4. **欄位驗證迴圈**：檢查 `chart_spec` 引用的 `x`/`y` 欄位是否存在於查詢結果；不存在則退回讓模型修正。
5. 前端用 **ECharts** 依 `chart_spec` 確定性渲染圖表，並在圖旁攤出生成的 SQL（#2 透明化）。

此切片刻意保持薄：schema 先用**一小組手動挑選的表**直接餵進 prompt（大 schema 的檢索留給切片 03）。`LLMProvider` 介面與 chart spec 型別在此確立。

chart spec 型別（來自 PRD，前後端共用）：

```ts
type ChartSpec = {
  chart_type: "bar" | "line" | "area" | "pie" | "table";
  x: string;          // 對應查詢結果欄位名
  y: string[];        // 一或多條 series
  title: string;
  aggregation?: "sum" | "avg" | "count" | "min" | "max" | null;
};
```

## Acceptance criteria

- [ ] 輸入自然語言問句可得到一張正確渲染的 ECharts 圖
- [ ] LLM 經 `LLMProvider` 介面呼叫（介面可日後替換 provider）
- [ ] 模型以 structured output 回傳符合 `ChartSpec` 的物件 + SQL
- [ ] 查詢對**唯讀**帳號執行
- [ ] chart_spec 引用不存在的欄位時，會觸發退回修正而非直接畫錯/崩潰
- [ ] 圖旁顯示生成的 SQL
- [ ] `ChartSpec` 型別為前後端共用的單一定義

## Blocked by

- 01 — Walking skeleton
