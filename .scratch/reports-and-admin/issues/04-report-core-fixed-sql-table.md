# 04 — 報表核心：固定 SQL → 表格（Report core）

Status: done

> Completed 2026-07-07. Prefactor：把 isReadOnly（移進 guardrails.ts，純函式）與
> executeGuarded（參數化 maxRows/timeout）抽到共用的 lib/analytics/execute.ts，engine 改用；
> 新增 runGuardedQuery（read-only belt→黑名單→執行→結果黑名單）給報表用，engine 與報表
> 共用同一組護欄 seam。guardrails 加 REPORT_MAX_ROWS(5000)/REPORT_STATEMENT_TIMEOUT_MS(15s)，
> enforceRowLimit 本就吃 max 參數 → 加 6 個單元測試（derived-table 包裝、CTE append、既有
> LIMIT 不動、可指定 cap、去分號）。新 report 表（author_id/title/query_sql，獨立於
> saved_query）+ lib/state/reports.ts CRUD + 純 parseReportInput（拒非唯讀 SQL）。API：
> GET/POST /api/reports、GET/PATCH/DELETE /api/reports/[id]、POST /api/reports/[id]/run，
> 各以 can(report:list/create/edit/delete/run) gate（route 自驗，defense in depth）。
> app/reports 頁：清單+執行看表格+Editor 內嵌建立/編輯/刪除表單；報表/語意層/使用者導覽入口。
> typecheck 乾淨、37/37 測試、next build 全綠（/reports 與 3 條 API 皆出現）。
> NOT verified（state DB 在內網、此處 ETIMEDOUT）：report DDL 對真 MySQL、建立→執行→表格
> 與角色 gating 的 end-to-end round-trip。

## Parent

`.scratch/reports-and-admin/PRD.md`

## What to build

引入 **Report** 一等公民的最小端到端路徑：Editor 手寫**固定**原生 SQL 存成一張具名報表，任何人從清單挑一張、執行、看到表格。此片先不做參數、圖、匯出（後續切片）。

- 新增獨立 `report` 表（**不合併 `saved_query`**；Trusted Query 維持原樣）。欄位含 title、原生 SQL、輸出模式（先固定 `table`）、作者、時間。
- Editor 以上可建立/編輯/刪除報表（硬刪除，v1 無版本無稽核）；所有角色可列清單與執行。
- 執行走 `analyticsPool()`（read-only），沿用既有 `isReadOnly` belt 與敏感欄位黑名單（執行前後）。
- **擴充 `enforceRowLimit`**：接受呼叫端指定的上限，讓報表預覽套用自己的上限（`REPORT_MAX_ROWS`，經設定服務或 env 取值），沿用其既有 CTE / derived-table 包裝邏輯。
- 報表區導覽：清單 / 執行 / 建立·編輯（建立·編輯僅 Editor 以上，接 01 的 gating）。與 AI 累積式儀表板完全分開。

## Acceptance criteria

- [ ] Editor 能建立含固定 SQL 的具名報表；Viewer 不能建/編/刪
- [ ] 任何角色能從清單挑一張報表並執行，看到表格結果
- [ ] 手寫 SQL 仍受既有護欄保護（read-only、敏感欄位黑名單、列上限、timeout）
- [ ] `enforceRowLimit` 擴充為可指定上限，並有單元測試涵蓋預覽上限與既有 CTE/derived-table 兩種包裝
- [ ] 報表區與 AI 儀表板為分開的頂層區塊

## Blocked by

- 01 — 角色地基（建立/編輯需 Editor gating）
