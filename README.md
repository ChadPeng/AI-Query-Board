# QueryBoard

內部分析工具：用自然語言問數據問題，AI 產生 SQL 查詢現有 MySQL，並把結果畫成可累積的儀表板圖表。

規格見 [`.scratch/ai-data-dashboard/PRD.md`](.scratch/ai-data-dashboard/PRD.md)，實作 issue 見 [`.scratch/ai-data-dashboard/issues/`](.scratch/ai-data-dashboard/issues/)。

> 目前進度：**slice 01 — Walking skeleton**。專案地基 + 兩個 MySQL 連線 + 對話/圖表版面骨架已就緒。AI 引擎（text-to-SQL → 圖表）在 slice 02 接上。

## 技術棧

- **Next.js 15 / React 19 / TypeScript**（App Router）
- **mysql2** 連線兩個獨立的 MySQL：
  - `ANALYTICS_DB` — 被查詢的**現有** DB，**唯讀**（建議連 replica、用 SELECT-only 帳號）
  - `STATE_DB` — app 自己的 DB，**讀寫**（之後存對話/儀表板/可信查詢/表目錄）

## 開始開發

```bash
npm install
cp .env.example .env        # 填入兩個 DB 的連線資訊（沒填也能啟動，只是 DB 檢查會回報未設定）
npm run dev                 # http://localhost:3000
```

其他指令：

```bash
npm run build       # production build
npm start           # 啟動 production server
npm run typecheck   # tsc --noEmit
```

## 環境變數

複製 `.env.example` 成 `.env` 並填入。兩組變數對應兩個**獨立**的 MySQL（連線字串/帳號互不相同）：

| 變數 | 用途 |
|---|---|
| `ANALYTICS_DB_*` | 現有 DB，唯讀（HOST/PORT/USER/PASSWORD/DATABASE） |
| `STATE_DB_*` | app 狀態庫，讀寫 |

## 連線驗證

- **啟動時**：`instrumentation.ts` 會在 server 啟動時驗證兩個連線並印出報告。其中 `ANALYTICS_DB` 會額外做**唯讀探測**——若該帳號其實有寫入/DDL 權限，會印出明顯警告（你應改用 SELECT-only 帳號）。
- **隨時**：`GET /api/health` 回傳兩個連線的即時狀態（全部可達回 200，否則 503）。

## 目前的端點

| 端點 | 說明 |
|---|---|
| `GET /` | 左側圖表區（暫空）+ 右側 AI 對話框 |
| `POST /api/ask` | 接收問句並回覆。**slice 01 尚未接 LLM**，僅證明 round-trip；引擎在 slice 02 接上 |
| `GET /api/health` | 兩個 DB 連線的健康檢查 |
