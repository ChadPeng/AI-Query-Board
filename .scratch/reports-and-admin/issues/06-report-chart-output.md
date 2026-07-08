# 06 — 圖輸出＋輸出模式（Chart output & output mode）

Status: done

> Completed 2026-07-07. 純 lib/reports/chart.ts：validateChartSpec（結構＋可選「引用欄位
> 須存在於結果欄位」）、normalizeChartSpec、isOutputMode，沿用既有 ChartSpec/referencedFields，
> 9 個單元測試。report 加 chart_spec JSON + output_mode ENUM(table/chart/both, default both)；
> reports.ts 存讀；parseReportInput 併驗（chart 模式必須有圖，both 無圖退表格）。新增
> POST /api/reports/preview（Editor+，試跑未存 SQL 拿欄位，小 cap；用 trialValues 餵必填參數
> 只為取欄位）。編輯器：輸出模式選單 + 「試跑取得欄位」→ 圖型/X/Y(多選)/標題選欄位（x/y 從
> 試跑欄位挑，結構上擋掉不存在欄位）；存檔前 client 再 validateChartSpec。執行頁依 output_mode
> 用既有 <Chart> 渲染圖與/或表格（沒配圖退表格）。不呼叫 LLM。typecheck 乾淨、64/64 測試、
> build 全綠。NOT verified（state DB 內網）：試跑/執行對真 MySQL、圖實際渲染的 end-to-end。

## Parent

`.scratch/reports-and-admin/PRD.md`

## What to build

讓報表能出圖。RD **手動指定** chart spec（不呼叫 LLM），報表帶輸出模式決定 Viewer 看到什麼。

- Report 加 chart spec（可空）與輸出模式欄位（`table` / `chart` / `both`，預設 `both`；沒配圖時退純表格）。
- Editor 編輯報表時可先試跑拿到結果欄位清單，據以手選圖型、把 x/y 對到結果欄位、填標題。沿用既有「引用欄位須存在於結果欄位」的 chart spec 驗證，通過才給存。
- Viewer 執行頁依輸出模式呈現表格與/或圖（沿用既有 `ChartSpec` → ECharts 確定性渲染）。
- 參數只過濾列不改欄，故 chart spec 一次設好後、不論填什麼參數皆有效。

## Acceptance criteria

- [ ] Editor 能為報表手動指定 chart spec，欄位映射錯誤（引用不存在欄位）會被擋下、不給存
- [ ] 報表輸出模式可設 table / chart / both，預設 both；沒配圖退純表格
- [ ] Viewer 執行時依輸出模式看到表格與/或圖
- [ ] 產圖過程不呼叫 LLM

## Blocked by

- 04 — 報表核心
