# 實機驗證清單（First-run Verification）

所有 8 個切片都過了 `typecheck` + `build` 與純邏輯單元測試，但**尚未在真實的 MySQL / LLM API 上跑過端到端**。這份清單是接上 `.env` 後要逐項確認的事。

> 圖例：每項標註它驗證哪個切片（#01–#08）。

---

## 0. 準備 `.env`

```bash
cp .env.example .env
```

填入：

| 變數 | 說明 |
|---|---|
| `LLM_PROVIDER` | `gemini`（先用 Google 免費 key 測）或 `claude` |
| `GEMINI_API_KEY` | aistudio.google.com/apikey（免費）。`LLM_PROVIDER=gemini` 時用 |
| `ANTHROPIC_API_KEY` | console.anthropic.com。`LLM_PROVIDER=claude` 時用 |
| `AUTH_SECRET` | 跑 `npx auth secret` 產生 |
| `ANALYTICS_DB_*` | 現有 MySQL 的**唯讀**帳號（最好連 replica） |
| `STATE_DB_*` | 另一個**獨立**的讀寫 MySQL（app 自己的家） |
| `GUARDRAIL_*` | 選填，預設即可 |

> 先用 Gemini 測：`LLM_PROVIDER=gemini` + 填 `GEMINI_API_KEY`，其餘 Claude 變數可留空。

---

## 1. 連線與唯讀驗證　(#01, #04)

```bash
npm run dev
```

- [ ] 啟動 log 出現 `[db] ANALYTICS_DB: connected, account is read-only ✓`
  - ⚠️ 若顯示 `connected but account has WRITE/DDL privileges` → 換成 SELECT-only 帳號再繼續
- [ ] 啟動 log 出現 `[db] STATE_DB: connected (read-write) ✓`
- [ ] 開 `http://localhost:3000` → 自動導向 `/login`（未登入被擋）　(#05)
- [ ] 直接打 `GET /api/health` 看兩個連線狀態

---

## 2. 註冊 / 登入 / Session　(#05)

- [ ] 在 `/login` 切到「建立帳號」→ 用 email + ≥8 字密碼註冊
- [ ] 自動登入並導向 `/`（看得到右上角 email）
- [ ] 重新整理仍保持登入（session 持久）
- [ ] 按「登出」→ 回到 `/login`，再開 `/` 又被擋
- [ ] （DB 檢查）`STATE_DB` 的 `users` 表裡密碼是 **bcrypt 雜湊**、非明文

---

## 3. 建立表目錄　(#03)

```bash
npm run bootstrap:catalog
```

- [ ] 腳本列出分析庫的表數量，逐張產生一句話描述、寫入 `table_catalog`
- [ ] 抽查 `table_catalog` 幾列描述是否合理
- [ ] **校對最關鍵的 ~20–30 張表**：描述對的，把該列 `reviewed` 設為 `1`（之後重跑不會被覆蓋）
- [ ] （可選）重跑一次 `npm run bootstrap:catalog`，確認 `reviewed=1` 的描述沒被覆寫

---

## 4. 核心：問句 → SQL → 圖　(#02, #03)

挑一個**你已知答案**的問題（例如「各產品類別的總營收」）。

- [ ] 圖正確、座標/數列合理
- [ ] 圖旁的「生成的 SQL」展開後，SQL 是對的（這是 #2 的透明化護欄，務必人工確認）
- [ ] 換一個需要 JOIN 多表的問題 → 確認 stage-1 有挑對表（SQL 用到正確的表）
- [ ] 問一個明顯不存在的資料 → 看到「找不到與問題相關的資料表」之類的明確訊息

---

## 5. 技術護欄　(#04)

- [ ] 問一個會掃大表的問題（或暫時把 `GUARDRAIL_STATEMENT_TIMEOUT_MS` 設很小）→ 看到「查詢逾時…請縮小範圍」
- [ ] 確認結果列數被 `GUARDRAIL_MAX_ROWS`（預設 1000）截斷
- [ ] 問會碰到敏感欄位的問題（如「列出使用者密碼」）→ 被「受限欄位」訊息擋下
- [ ] （DB 檢查）唯讀帳號真的不能寫（嘗試任何寫入被拒）

---

## 6. 累積式儀表板　(#06)

- [ ] 對一張結果按「📌 釘選到儀表板」→ 出現在左側網格
- [ ] **重新整理頁面** → 釘選的圖原樣還原（持久化成功）
- [ ] 按某張圖的「✕」→ 移除，重新整理後確實不見
- [ ] 用第二個帳號登入 → 看不到第一個帳號的圖（個人模型隔離）

---

## 7. 可信查詢庫 / 飛輪　(#08)

- [ ] 釘選某個問題的結果後，**再問一次同樣的問題** → 聊天顯示「♻️ 重用了你已驗證過的查詢」（且明顯更快）
- [ ] 換句話問同一件事（如「各類別營收總和」vs「各產品類別的總營收」）→ 確認 LLM 換句話比對也能命中重用
- [ ] （DB 檢查）`saved_query` 有對應列、`shared=0`（個人）

---

## 8. 追問（對話上下文）　(#07)

- [ ] 先問「今年各月營收」→ 再追問「把第三季拆成週」→ 第二張圖正確沿用上下文（週粒度、限 Q3）
- [ ] **重新整理** → 對話內容還原、可繼續接著問
- [ ] 按「新對話」→ 聊天清空，下一個問題不帶舊上下文（全新獨立）

---

## 切換到 Claude（之後）

測完 Gemini 要換正式的 Claude：把 `.env` 改成 `LLM_PROVIDER=claude` 並填 `ANTHROPIC_API_KEY`，重啟即可——引擎、護欄、檢索、追問、可信查詢全部不變（同一個 provider 介面）。可重跑第 4–8 項對照兩家模型的 text-to-SQL 品質。

---

## 已知限制 / 待辦（非阻斷）

- 儀表板存的是**資料快照**；目前沒有「重新整理跑即時資料」按鈕（`query_sql` 已存好，未來可加）。
- 版面只有順序（append），還沒有拖拉重排。
- 語意正確性靠「攤 SQL + 可信查詢」，沒有自動驗證（grilling 時的決定）。
- 失敗/零結果的細緻 UX、LLM 成本/速率控制可再打磨（PRD §7 開放項）。
