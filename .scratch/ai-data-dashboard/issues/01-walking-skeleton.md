# 01 — Walking skeleton（地基）

Status: done

> Completed 2026-06-22. Next.js 15 + TS scaffold at repo root; two mysql2 pools
> (analytics read-only + state read-write) from env with startup verification
> (`instrumentation.ts`) and a read-only probe; left chart area + right chat UI;
> `POST /api/ask` round-trip (no LLM yet) + `GET /api/health`. typecheck + build pass.

Source: `.scratch/ai-data-dashboard/PRD.md`（里程碑 1）

## What to build

建立專案地基並證明端到端接線通了。一個 Next.js（全 TypeScript）應用，能同時連上兩個 MySQL——**唯讀分析庫**（現有 DB / replica，只讀帳號）與**讀寫狀態庫**（app 自己的獨立 instance）。

頁面為最終版面的骨架：右側一個對話輸入框、左側一塊空的圖表區。使用者送出問句時，請求會 round-trip 到後端 API route 再回到前端顯示（此階段**先不接 LLM**，可回固定字串或 echo）。兩個 DB 連線要能在啟動時驗證可達。

## Acceptance criteria

- [ ] Next.js + TypeScript 專案可在本機啟動
- [ ] 唯讀分析庫連線成功，且帳號確實只有讀權限（嘗試寫入會被拒）
- [ ] 讀寫狀態庫連線成功，可建立/讀取一張測試表
- [ ] 頁面有右側對話輸入框與左側空圖表區
- [ ] 送出問句會打到 API route 並把回應顯示在前端
- [ ] 兩個 DB 連線設定來自環境變數，連線字串/帳號彼此獨立

## Blocked by

None - can start immediately
