# 04 — 技術護欄硬化

Status: done

> Completed 2026-06-22. lib/guardrails.ts: forced row cap (non-CTE queries
> wrapped as a derived table so an inner LIMIT can't exceed the cap; CTEs get a
> LIMIT appended), statement timeout (server SET SESSION MAX_EXECUTION_TIME +
> client-side mysql2 timeout, with isTimeoutError → friendly "查詢逾時" message),
> and a table/column blacklist (pre-execution identifier check + post-execution
> result-column check to catch SELECT * leaks). All configurable via
> GUARDRAIL_* env vars (defaults: 1000 rows, 5s, PII/secret column set). Wired
> into the engine around executeGuarded; violations return ok:false with a
> user-facing reason. Read-only account verification was already done at startup
> (slice 01 instrumentation + probe). typecheck + build pass; 11/11 pure-logic
> unit checks pass (limit wrapping, CTE handling, word-boundary blacklist,
> SELECT * column leak). NOTE: live timeout/LIMIT behavior against a real MySQL
> not exercised here (no DB) — verify after connecting the analytics replica.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 4 節）

## What to build

把查詢執行路徑端到端變安全，擋住動態 text-to-SQL 的技術層風險。在切片 02 已有的「唯讀帳號 + 攤 SQL」基礎上，補齊其餘護欄：

- **強制注入 `LIMIT`**：對所有生成的 SQL 自動加上列數上限（已有 LIMIT 則尊重或收斂到上限內）。
- **statement timeout**：執行超時即中止，避免全表掃描/大 join 拖垮 DB。
- **表/欄位黑名單**：禁止查詢敏感表與欄位（如 `password`、PII），命中即拒絕並回報使用者。
- **read-only 帳號強制驗證**：啟動時確認連線帳號無寫入/DDL 權限。

護欄違規時，使用者要看到清楚的訊息（為什麼被擋），而非無聲失敗。

## Acceptance criteria

- [ ] 任何生成的查詢都被強制套用列數上限
- [ ] 超過 statement timeout 的查詢會被中止並回報
- [ ] 查詢命中黑名單的表/欄位時被拒絕，並向使用者說明原因
- [ ] 啟動時驗證分析庫帳號為唯讀
- [ ] 護欄擋下的情況都有面向使用者的明確訊息

## Blocked by

- 02 — 端到端 text-to-SQL → 一張圖
