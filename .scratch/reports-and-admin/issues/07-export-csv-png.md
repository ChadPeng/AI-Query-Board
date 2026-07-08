# 07 — 匯出（CSV＋PNG）

Status: done

> Completed 2026-07-07. 純 lib/reports/csv.ts：toCsv —— UTF-8 BOM 前綴（Excel 繁中不亂碼）、
> CRLF、含逗號/引號/換行的欄位加引號並雙寫引號、null→空、物件→JSON、欄序穩定，5 個單元測試
> （含 charCodeAt(0)===0xFEFF 驗 BOM）。guardrails 加 REPORT_EXPORT_MAX_ROWS(10萬)。獨立
> 匯出路徑 POST /api/reports/[id]/export：綁定同 run、走高 cap、回 text/csv + Content-Disposition
> （filename* UTF-8 支援中文檔名）。Chart 元件改 forwardRef 曝 toPng()（getDataURL，table 回
> null），向後相容既有 dashboard 用法。報表執行頁加「匯出 CSV」（fetch→blob→下載，重跑高 cap
> ＝完整資料）與「下載 PNG」（有圖時）。typecheck 乾淨、69/69 測試、build 全綠。
> NOT verified（state DB 內網）：真 MySQL 匯出大資料、PNG 實際下載的 end-to-end。

## Parent

`.scratch/reports-and-admin/PRD.md`

## What to build

讓 Viewer 把報表結果帶走：資料匯出成 CSV（可用 Excel 開、繁中不亂碼），圖下載成 PNG。

- **獨立匯出執行路徑**：與畫面預覽分開，套用較高的匯出上限（`REPORT_EXPORT_MAX_ROWS`，經設定服務/env 取值，仍有帽子避免 OOM），沿用擴充後的 `enforceRowLimit`。
- **CSV 序列化純函式**：`columns + rows` → CSV 字串，前置 **UTF-8 BOM**（避免 Excel 開繁中亂碼），正確跳脫含逗號/雙引號/換行的值，處理 null/undefined，欄位順序穩定。
- **PNG**：圖區加「下載圖片」，用 ECharts `getDataURL()`。
- 匯出仍走 read-only 護欄與敏感欄位黑名單。

## Acceptance criteria

- [ ] CSV 序列化為純函式並有單元測試：UTF-8 BOM 前綴、逗號/引號/換行跳脫、null 處理、欄位順序穩定
- [ ] Viewer 能匯出報表結果為 CSV，Excel 開啟繁體中文正常
- [ ] 匯出走獨立路徑並套用較高的 `REPORT_EXPORT_MAX_ROWS`（有上限帽子）
- [ ] 有圖時可下載 PNG

## Blocked by

- 04 — 報表核心（PNG 部分軟相依 06 — 圖輸出）
