step => /grill-me xxxxxxx
2 => /to-prd
3 => /to-issue


























# PRD：AI 數據儀表板

> 內部分析工具——使用者用自然語言問數據問題，AI 產生 SQL 查詢現有 MySQL，並把結果畫成可累積的儀表板圖表。
>
> 本文件為開工的單一事實來源，決策來自 grilling session。實作 issue 拆解見 `.scratch/ai-data-dashboard/issues/`。

---

## 1. 目標與範圍

**定位**：內部分析工具（非 SaaS、非 demo）。查詢**單一、已存在**的 MySQL 資料庫。

**核心價值**：讓不會寫 SQL 的內部同事，用自然語言問出數據並得到圖表；讓會寫 SQL 的人省去重複造輪子。

**明確不做（暫不在範圍內）**：
- 多租戶 / 客戶連自己的 DB
- 自動化語意正確性驗證（靠「攤 SQL + 人工判斷 + 可信查詢累積」緩解）
- 修改現有 DB 的 schema / 命名（現有 DB，改不動）

---

## 2. 使用者體驗

版面：**左側圖表區 + 右側 AI 對話框**。

- **對話框**：使用者輸入數據問題；支援**追問**（帶對話歷史上下文，例如先問「今年各月營收」再追問「把 Q3 拆成週」）。
- **圖表區**：**累積式儀表板**。每次問答產生的圖可**釘選**到左側，逐步拼成多圖儀表板；對話框是「新增/修改圖表」的入口。
- **每張圖旁邊攤出**：(a) 生成的 SQL、(b) 一句白話說明這張圖怎麼算的。使用者可一眼看出 AI 有沒有誤解問題，並可「修正 SQL 重跑」。
- **釘選 = 信任**：使用者確認對的圖釘起來，其背後 SQL 進入「可信查詢庫」，同類問題優先重用。

---

## 3. 核心引擎：text-to-SQL → 圖表

管線：

```
使用者問句 (+ 對話歷史)
  → ① Schema 檢索：兩階段 LLM 挑表
  → ② LLM 一次輸出 { SQL, chart_spec }（structured output）
  → ③ 對唯讀 MySQL 執行 SQL
  → ④ 驗證：chart_spec 引用的欄位是否存在於查詢結果？否 → 退回修正
  → ⑤ ECharts 確定性渲染
```

### 3.1 Schema 檢索（兩階段 LLM 挑表）

現有 DB 有數十~上百張表，**不能每次把完整 schema 全塞給模型**。

1. **精簡目錄**：餵一份「每張表一行：表名 + 一句話用途」的目錄，讓 LLM 選出相關的 5~10 張表。
2. **取完整 DDL**：把選中表的完整 `CREATE TABLE` 餵進去產生 SQL。

**表目錄為必做元件**（檢索的成敗全靠它）：
- 用 AI 半自動 bootstrap：腳本抓所有 `CREATE TABLE` + 抽樣資料 → Claude 產生每張表初版一句話說明。
- 人工只校對最關鍵的 ~20-30 張表（80/20），其餘先用 AI 生成描述頂著。
- 目錄存在狀態庫，可持續修訂。

### 3.2 LLM 輸出合約（chart spec）

LLM **一次**輸出 SQL + 一份**自訂窄 chart spec**，用 structured output 強制格式：

```ts
type ChartSpec = {
  chart_type: "bar" | "line" | "area" | "pie" | "table"; // enum，LLM 不能吐未實作的圖型
  x: string;          // 對應查詢結果欄位名
  y: string[];        // 一或多條 series，對應查詢結果欄位名
  title: string;
  aggregation?: "sum" | "avg" | "count" | "min" | "max" | null;
};
```

- **欄位驗證迴圈**：跑完 SQL 拿到結果欄位後，檢查 `x`/`y` 是否真的存在於結果集；不存在則退回讓 LLM 修正。此檢查擋掉大半「圖畫歪」。
- 此型別前後端共用（全 TS）。

### 3.3 模型

- 主棒用 **Claude**：`claude-sonnet-4-6` 起步（便宜快），難問句升 `claude-opus-4-8`。
- 程式碼留一層 **`LLMProvider` 介面**；之後可加 GPT / 本地 Ollama adapter（Ollama = HTTP/OpenAI 相容 endpoint，與 app 語言無關）。
- 注意：本地小模型在複雜 schema 的 text-to-SQL 上能力差一截，短期主棒仍靠前沿模型；本地模型適合輔助任務（挑表、產標題）或資料極敏感場景。

---

## 4. 安全與護欄

**風險分兩層**：技術層全做；語意層只做輕量緩解（攤 SQL + 可信查詢），不做自動驗證。

技術層護欄（全做）：
- **獨立 read-only MySQL 帳號**，只授權特定 schema（擋寫入 / DDL）。
- 後端**強制注入 `LIMIT`** + **statement timeout**（擋跑垮）。
- **資料表 / 欄位黑名單**（擋撈出 `password`、PII 欄位）。
- **SQL 先顯示給使用者看再執行**（透明、可稽核）。
- 分析查詢連**唯讀 replica**（非主庫）；若無 replica，read-only 帳號 + timeout + 離峰/併發限制必須做滿。

---

## 5. 技術棧

| 層 | 選型 |
|---|---|
| 全棧 | **TypeScript / Next.js**（React 前端 + API routes 後端；前後端共用 chart spec 型別） |
| 圖表庫 | **ECharts**（圖型齊全、適合儀表板；因 spec 抽象，可換） |
| 分析庫（被查詢） | **現有 MySQL 唯讀 replica**，read-only 帳號 |
| 狀態庫（app 自己的） | **獨立 MySQL**（讀寫），與分析庫物理分開、不同連線/帳號 |
| LLM | Claude API，經 `LLMProvider` 介面 |
| Auth | **自建帳密**，用 **Auth.js (Credentials)** 或 **Lucia**；密碼 `bcrypt`/`argon2`，勿自刻 |
| 部署 | **內網自架**（Docker Compose 起步）；app 與兩個 DB 同內網 |

---

## 6. 資料模型（狀態庫，初版）

存於獨立讀寫 MySQL（5.7+ 用 `JSON` 欄位存 spec / 版面）：

- `user`：自建帳密（雜湊後密碼、email…）。
- `conversation` / `message`：對話 session 與歷史（追問用）。
- `dashboard`：owner = user，**個人模型**（暫不分享）。版面（哪些圖、位置）以 JSON 存。
- `chart`：屬於某 dashboard；存 chart_spec(JSON)、產生它的 SQL、來源 message。
- `saved_query`（可信查詢庫 / #3）：使用者釘選確認過的查詢。**個人範圍**——預留 `shared` flag，未來可升級為全公司共用以啟動「越多人用越準」的飛輪。
- `table_catalog`：每張表的一句話說明（AI bootstrap + 人工校對）。

> 分享模型目前選**個人**：#3 飛輪只在單人內轉，全公司語意知識不複利累積。若團隊變大想打開，加 `shared` flag 即可升級——資料模型先不擋死。

---

## 7. 待確認 / 開放項

- [ ] **是否已有可用的唯讀 replica？** 若無，需連主庫並加強 timeout / 離峰 / 併發限制。
- [ ] 查詢失敗 / 零結果的 UX（錯誤訊息、引導重問）。
- [ ] LLM 呼叫的成本 / 速率控制（per-user 限額？快取相同問句？）。
- [ ] 串流逐字輸出的細節。
- [ ] 首次上線 onboarding 流程：連 DB → 跑表目錄 bootstrap → 人工校對核心表。

---

## 8. 里程碑（建議切法）

1. **地基**：Next.js 專案 + 兩個 MySQL 連線（唯讀分析庫 + 讀寫狀態庫）+ 自建帳密登入。
2. **引擎 MVP**：表目錄 bootstrap 腳本 → 兩階段挑表 → LLM 出 SQL + chart spec → 唯讀執行 + 欄位驗證 → ECharts 渲染（單張圖、無追問）。
3. **護欄**：read-only 帳號、強制 LIMIT/timeout、黑名單、SQL 攤開可稽核。
4. **儀表板互動**：釘選累積、版面持久化、追問（帶對話歷史）。
5. **可信查詢庫 (#3)**：釘選圖入庫，同類問句優先重用。
6. **打磨**：失敗 UX、成本控制、onboarding、`LLMProvider` 介面與本地模型實驗。
