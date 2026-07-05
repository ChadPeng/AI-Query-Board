# 07 — 追問（對話上下文）

Status: done

> Completed 2026-06-22. conversation + conversation_turn tables (state migrations,
> user-scoped). lib/state/conversations.ts: createConversation / addTurn /
> getLatestConversationId / getTurns. History (prior question+SQL) is threaded
> into SqlChartRequest and rendered in the SQL prompt with explicit follow-up
> guidance ("the new question may be a FOLLOW-UP that refines the most recent
> one — adapt the prior SQL; if unrelated, answer standalone"). Engine takes
> RunEngineOptions {userId, history}; trusted-query reuse (#3) is gated to the
> first turn (history empty) so a follow-up always goes through generation with
> context. /api/ask loads prior turns by conversationId, runs with history,
> persists the new turn (best-effort), and returns conversationId; GET
> /api/conversation restores the latest conversation. UI: chat restores on mount,
> tracks conversationId across turns, 新對話 button starts fresh. typecheck + build
> pass; clean boot; /api/conversation + /api/ask auth-gated (307). NOT verified
> (no STATE_DB/key): real follow-up refinement + persistence/restore round trip.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 2 節）

## What to build

支援依賴前一輪的追問，讓數據探索能連續進行。

- 對話歷史（前面的問句與其產生的 SQL/結果摘要）會帶進 LLM prompt。
- 追問（例如先問「今年各月營收」，再問「把 Q3 拆成週」）能正確理解上下文，產生精修後的 SQL 與圖。
- 對話 session 與 message 持久化到狀態庫（`conversation`/`message`）。

需注意：追問通常是「修改上一張圖」的語意，prompt 設計要讓模型知道是延續而非全新問題。

## Acceptance criteria

- [ ] 對話歷史會帶入 LLM prompt
- [ ] 一個依賴前一輪上下文的追問能產生正確的精修查詢與圖
- [ ] 對話 session 與訊息持久化，可在重新載入後接續
- [ ] 全新問題（非追問）仍能正常獨立處理

## Blocked by

- 02 — 端到端 text-to-SQL → 一張圖
