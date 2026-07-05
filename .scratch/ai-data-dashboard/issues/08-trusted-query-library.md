# 08 — 可信查詢庫（#3）

Status: done

> Completed 2026-06-22. `saved_query` table (state migrations): user_id-scoped,
> question + question_norm + query_sql + chart_spec + shared flag, UNIQUE
> (user_id, question_norm) so re-confirming updates. lib/state/savedQueries.ts:
> normalizeQuestion (pure), saveQuery (ON DUPLICATE KEY UPDATE), findExactSavedQuery,
> listSavedQuestions, getSavedQueryById — all scoped (user_id OR shared=1), so the
> shared flag is already wired for a future org-wide upgrade with no schema change.
> Save-on-pin: /api/dashboard POST records the question→SQL pair (best-effort, never
> fails the pin). Reuse in engine (before retrieval/generation): exact normalized
> match → conservative LLM paraphrase match (provider.matchSavedQuestion, validates
> the returned id) → run the validated SQL under the same guardrails + column
> validation; stale/guardrail failure falls through to normal generation. Success
> carries fromSaved:true; the UI shows "♻️ 重用了你已驗證過的查詢". Personal scope.
> typecheck + build pass; 6/6 normalizeQuestion unit checks pass (case/whitespace/
> trailing-punct incl. fullwidth, paraphrase-normalization equality); clean boot,
> /api/ask still auth-gated. NOT verified (no STATE_DB/key): real save→reuse round
> trip and the LLM paraphrase match — verify after the state DB + API key are set.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 2、6 節）

## What to build

把使用者確認過的查詢累積成「可信查詢庫」，讓同類問題越用越準。

- 釘選/確認過的圖，其背後 SQL 進入該使用者的 `saved_query`（**個人範圍**）。
- 新問句進來時，先比對可信查詢庫；命中同類問題時優先重用已驗證的 SQL，而非每次重新生成。
- 資料模型 `saved_query` 預留 `shared` flag（目前都為個人；未來升級成全公司共用以啟動「越多人用越準」飛輪）。

此切片承接切片 06 的釘選動作——釘選即視為「使用者確認此查詢正確」。

## Acceptance criteria

- [ ] 釘選/確認過的查詢會存入個人可信查詢庫
- [ ] 新問句會先比對可信查詢庫，命中同類時優先重用已驗證 SQL
- [ ] `saved_query` 含 `shared` flag（預設個人），資料模型不擋死未來共享升級
- [ ] 可信查詢為個人範圍，不跨使用者外洩

## Blocked by

- 06 — 累積式儀表板（釘選 + 版面持久化）
