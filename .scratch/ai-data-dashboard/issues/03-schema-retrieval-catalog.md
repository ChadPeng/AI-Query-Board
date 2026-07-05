# 03 — Schema 檢索（兩階段挑表）+ 表目錄

Status: done

> Completed 2026-06-22. Two-stage retrieval (lib/schema/retrieval.ts): stage 1
> `provider.selectTables` picks ≤10 tables from the compact catalog, stage 2
> `getCreateTablesFor` fetches only those DDLs → fed to the slice-02 generator.
> Engine resolves schema once before the repair loop; empty/invalid selection →
> NoRelevantTablesError ("找不到與問題相關的資料表"); empty catalog → sample-schema
> fallback so the app works pre-bootstrap. Catalog stored in state DB
> `table_catalog` (lib/state/migrate.ts + catalog.ts); upsert preserves
> human-reviewed rows (reviewed=1) on re-run. Read-only introspection in
> lib/schema/introspect.ts (information_schema, SHOW CREATE TABLE, sample rows).
> Bootstrap script scripts/bootstrap-catalog.ts (`npm run bootstrap:catalog`, via
> tsx, --env-file-if-exists) — AI-describes every table, upserts catalog, prompts
> to review core tables. typecheck + build pass; bootstrap script + request path
> verified to degrade gracefully (no env). NOTE: live >50-table selection accuracy
> not exercised here (no DB/key) — verify after bootstrap against the real DB.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 3.1 節）

## What to build

讓引擎能在**數十~上百張表**的真實現有 DB 上運作，取代切片 02 的手動 schema 餵入。

兩個部分：

1. **表目錄 bootstrap**：一支腳本抓出分析庫所有 `CREATE TABLE` + 每張表抽樣少量資料，丟給 Claude 生成「每張表一句話用途」說明，寫入狀態庫的 `table_catalog`。人工只需校對最關鍵的 ~20-30 張表，其餘先用 AI 生成描述頂著。

2. **兩階段 LLM 挑表**：問句進來時——
   - 階段一：餵精簡目錄（表名 + 一句話用途）給 LLM，選出相關的 5~10 張表。
   - 階段二：取那幾張表的完整 `CREATE TABLE` 餵進切片 02 的引擎產生 SQL。

完成後，問句在完整大 schema 上也能挑對表、產生正確 SQL。

## Acceptance criteria

- [ ] bootstrap 腳本可對整個分析庫產生 `table_catalog` 並寫入狀態庫
- [ ] 表目錄可被人工修訂（編輯某表說明後生效）
- [ ] 問句經兩階段挑表，第一階段選出相關表、第二階段只餵選中表的 DDL
- [ ] 在 >50 張表的 schema 上，常見問句能挑對表並產生可執行 SQL
- [ ] 挑表失敗（找不到相關表）時有明確處理，而非餵全 schema 或崩潰

## Blocked by

- 02 — 端到端 text-to-SQL → 一張圖
