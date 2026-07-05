# 06 — 累積式儀表板（釘選 + 版面持久化）

Status: done

> Completed 2026-06-22. `pinned_charts` table (state migrations): user_id-scoped,
> stores chart_spec + result_columns + result_rows (data snapshot) + query_sql +
> position, so restore is self-contained (query_sql kept for a future live-refresh).
> lib/state/dashboard.ts: listPinnedCharts / addPinnedChart (append at max+1) /
> removePinnedChart — all owner-scoped (DELETE ... AND user_id). Routes: GET/POST
> /api/dashboard, DELETE /api/dashboard/[id], each auth()-gated and using the
> session user id. UI: dashboard loads on mount; the latest /api/ask result shows
> as a "未釘選" preview card with a 📌 釘選 button; pinned charts render in a grid
> (each with title, chart, SQL, ✕ remove). Personal model — each user sees only
> their own rows. typecheck + build pass; all three dashboard endpoints verified
> auth-gated (307 → /login when unauthenticated). NOT verified (no STATE_DB):
> real pin→persist→reload→restore and cross-user isolation — verify after the
> state DB is connected. Chose a data snapshot over re-running queries on load so
> restore works without the analytics DB; live-refresh can be added later.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 2、6 節）

## What to build

讓圖表區從「一問一圖」變成可累積的個人儀表板。

- 使用者可把產生的圖**釘選**到左側圖表區。
- 釘選的圖（chart_spec + 來源 SQL + 標題）與**版面**（哪些圖、位置）持久化到狀態庫，綁定該使用者（個人模型）。
- 重新整理/重新登入後，儀表板版面原樣還原。
- 可移除已釘選的圖。

資料模型：`dashboard`（owner、版面 JSON）、`chart`（chart_spec JSON、來源 SQL）。

## Acceptance criteria

- [ ] 可把一張產生的圖釘選到儀表板
- [ ] 釘選的圖與版面持久化到狀態庫，綁定使用者
- [ ] 重新整理/重新登入後儀表板原樣還原
- [ ] 可移除已釘選的圖
- [ ] 不同使用者看到各自的儀表板（個人模型）

## Blocked by

- 02 — 端到端 text-to-SQL → 一張圖
- 05 — 自建帳密登入
