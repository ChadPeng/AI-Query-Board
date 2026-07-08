# 08 — AI 結果升格為報表（Promote AI result to Report）

Status: done

> Completed 2026-07-07. app/page.tsx（儀表板）AI 最新結果卡片加「⇧ 升格為報表」鈕，僅
> can(role,'report:create')＝Editor 以上可見。promote() 以 preview 的 sql + chart_spec
> POST /api/reports 建新報表：title 取自問句（截 255），無參數；chart_type='table' 的 AI
> 結果 → outputMode='table'+chartSpec=null（報表圖僅 bar/line/area/pie），否則 both+帶 spec。
> 沿用既有建立路由（parseReportInput 結構驗證）。成功顯示提示「可到報表頁加參數」，新結果
> 進來時清掉舊提示。typecheck 乾淨、69/69 測試、build 全綠。
> NOT verified（state DB 內網）：升格→報表清單→執行的 end-to-end。

## Parent

`.scratch/reports-and-admin/PRD.md`

## What to build

打通第二條報表建立路徑：Editor 在 AI 對話得到滿意結果時，一鍵把它「升格」成一張 Report，不必手抄 SQL 與圖設定。

- 在既有 AI 結果（含 `query_sql` 與 `chart_spec`，見 `saved_query` / 引擎產出）上加「升格為報表」動作，僅 Editor 以上可見。
- 升格＝以該次的 `query_sql` 與 `chart_spec` 建立一張新 `report`（沿用既有資料，不新增產圖邏輯）。
- 升格後的報表可再由 Editor 進編輯器加上 Report Parameter（承 05）。

## Acceptance criteria

- [ ] Editor 能從 AI 結果一鍵升格為報表，新報表帶入原 SQL 與 chart spec
- [ ] Viewer 看不到升格動作
- [ ] 升格後的報表出現在報表清單、可正常執行
- [ ] 升格後可再進編輯器補上參數

## Blocked by

- 04 — 報表核心
- 06 — 圖輸出（帶入 chart spec）
