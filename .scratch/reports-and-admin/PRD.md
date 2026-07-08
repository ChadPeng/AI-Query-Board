# PRD — Reports、RD 手寫 SQL、角色與設定中心

Status: ready-for-agent

Source: 2026-07-06 grilling session（見 `CONTEXT.md` 的 Report / Report Parameter / Role / Setting 詞條，以及 `docs/adr/0004-user-roles.md`、`docs/adr/0005-db-backed-settings-and-encrypted-secrets.md`）

---

## Problem Statement

目前 QueryBoard 只有一種取數方式：使用者在 AI 對話框用自然語言問，AI 產生 SQL、跑出結果、畫成圖。這對「探索式分析」很好，但有兩個缺口：

1. **營運端（非技術）需要的是「每天固定要看的那幾張數字」**，而不是每次重新問 AI、每次結果可能不同。他們要的是「打開一張既定報表、選個日期區間、按執行、看表格、匯出 Excel」。
2. **RD 心裡清楚正確的 SQL**，卻沒有任何地方能把手寫 SQL 直接交給營運端重複使用——現有 `saved_query`（Trusted Query）只能靠釘圖的副作用產生、且是隱形的個人快取，無法當作「發佈給別人用的產物」。

同時，系統所有可調參數（列上限、timeout、敏感欄位黑名單、納入的 schema、LLM provider/模型、連線資訊）都寫死在 `.env`，任何微調都要改檔重啟，缺乏彈性；也沒有任何角色概念，無法區分「誰能寫 SQL 發佈」與「誰只能跑」。

## Solution

新增一個一等公民概念 **Report**：一個具名、可重用、可帶參數的查詢產物，發佈給營運端隨時自行執行。

- **兩條建立路徑**：Editor（RD）直接手寫原生 SQL；或把 AI 產生的好結果一鍵「升格」成 Report（複製其 SQL + chart spec）。
- **Report Parameter**：Report 可宣告具名、具型別的參數（日期/日期區間、數字、文字、固定清單 enum）。營運端執行時填一張表單，值以**預備語句綁定**塞進 SQL，絕不字串拼接。
- **輸出**：執行後即時跑（走 read-only 護欄），依 Report 的輸出模式（table / chart / both）呈現**表格**（可匯出 CSV，含 UTF-8 BOM）與/或**圖**（可下載 PNG）。
- **角色（Role）**：三層——Super Admin / Editor（RD）/ Viewer（營運），單一角色、上位涵蓋下位，用來治理「誰能發佈 vs 誰只能跑」。
- **設定中心（Setting）**：設定從 `.env` 搬進 state DB，Super Admin 可即時編輯免重啟（優先序 DB → env → 內建預設）；祕密設定加密存放。

Report 與現有的「AI 累積式儀表板」**完全分開**，是導覽上獨立的頂層區塊。

## User Stories

**營運端（Viewer）**

1. 作為營運人員，我想從一份報表清單挑選要看的報表，這樣我不必每次都重新向 AI 描述我要的東西。
2. 作為營運人員，我想在執行報表前填入參數（例如起訖日期、某個代碼），這樣同一張報表能套用到我當下關心的區間或對象。
3. 作為營運人員，我想看到報表以表格呈現的結果，這樣我能逐列核對數字。
4. 作為營運人員，我想在報表有配圖時看到圖，這樣我能快速掌握趨勢。
5. 作為營運人員，我想把報表結果匯出成可用 Excel 開啟的檔案（CSV，繁體中文不亂碼），這樣我能離線加工或轉寄。
6. 作為營運人員，我想把圖下載成 PNG，這樣我能貼進簡報或郵件。
7. 作為營運人員，當我沒填必填參數時，我想看到清楚的提示，這樣我知道要補什麼而不是拿到錯誤結果。
8. 作為營運人員，我想看到報表當前套用的參數值，這樣我知道眼前的數字是哪個條件下跑出來的。
9. 作為營運人員，我不應該能修改報表的 SQL，這樣我不會不小心弄壞別人也在用的報表。

**RD（Editor）**

10. 作為 RD，我想直接手寫原生 SQL 並存成一張具名報表，這樣我能把我知道正確的查詢交給營運端重複使用。
11. 作為 RD，我想在 SQL 裡用具名佔位符宣告參數（例如 `:start_date`），並替每個參數指定型別、顯示標籤與預設值，這樣營運端能安全地帶參數執行。
12. 作為 RD，我想在存檔前先試跑一次拿到結果欄位清單，這樣我能據以設定圖表。
13. 作為 RD，我想手動指定報表的 chart spec（圖型、x/y 對應欄位、標題），這樣營運端看到的是我設計好的圖而非 AI 亂猜。
14. 作為 RD，我想設定報表的輸出模式（表格/圖/兩者），這樣我能控制營運端看到什麼。
15. 作為 RD，我想把一個 AI 對話中產生的滿意結果一鍵升格成報表，這樣我不必手抄它的 SQL 和圖設定。
16. 作為 RD，我想編輯既有報表的 SQL、參數與圖，這樣我能修正或調整已發佈的報表。
17. 作為 RD，我想刪除不再需要的報表，這樣清單保持整潔。
18. 作為 RD，我希望我手寫的 SQL 仍受既有護欄保護（read-only、敏感欄位黑名單、預備語句綁定、列上限、timeout），這樣即使我寫錯也不會撈到密碼或打爆資料庫。
19. 作為 RD，我希望固定清單 enum 參數在營運端呈現為下拉選單，這樣他們只能選我允許的值。

**Super Admin**

20. 作為超級管理員，我想指派使用者的角色（Super Admin / Editor / Viewer），這樣我能控管誰能寫 SQL、誰只能跑。
21. 作為超級管理員，我想在 UI 上即時調整營運參數（預覽列上限、匯出列上限、statement timeout、敏感欄位黑名單、納入的 analytics schema），這樣微調不必改 `.env` 或重啟。
22. 作為超級管理員，我想在 UI 上設定/切換 LLM provider 與模型名稱，這樣不重啟就能換模型。
23. 作為超級管理員，我想輸入分析資料庫連線與 LLM 金鑰等祕密設定，且它們加密存放、在 UI 上只能覆寫不回顯，這樣即使 DB 備份外洩也不致直接洩漏祕密。
24. 作為超級管理員，在全新安裝時我想有一個初始設定精靈引導我填入分析庫連線與 LLM 金鑰，這樣系統從零就能被設定起來。
25. 作為超級管理員，當我改了連線或 provider 設定時，我希望變更即時生效（連線池/provider 熱重載），這樣不必重啟服務。
26. 作為超級管理員，我想看到目前每個設定值的來源（來自 DB 覆寫、還是 env 預設），這樣我知道哪些被我改過。

**跨角色**

27. 作為任何登入者，我希望上位角色能做下位角色的事（Super Admin 能建報表也能跑、Editor 能跑報表），這樣不必為了跑報表另開帳號。
28. 作為 Editor 以上，我想從導覽進入「報表」區並看到建立/編輯入口；作為 Viewer，我只看到執行入口，這樣介面符合我的權限。

## Implementation Decisions

**Report 資料模型**
- 新增獨立的 `report` 資料表（一等公民），**不合併進 `saved_query`**（Trusted Query 維持原樣、繼續當隱形個人快取）。理由見 grilling Q3。
- Report 欄位（概念層，非最終 DDL）：id、title、原生 SQL 模板（含具名佔位符）、參數宣告（結構化，見下）、chart spec（可空）、輸出模式（`table` / `chart` / `both`，預設 `both`）、作者、建立/更新時間。
- 參數宣告為結構化清單，每項含：名稱（對應 SQL 中的 `:name`）、型別（`date` / `date_range` / `number` / `text` / `enum`）、顯示標籤、預設值、enum 的固定選項清單。
- 治理採 v1 最簡：**即時生效、無版本、無稽核**。刪除為硬刪除。

**參數綁定（安全核心，測試 seam #1）**
- 抽出一個**純函式**：輸入（SQL 模板、參數宣告、使用者填入的值），輸出（可交給 mysql2 的預備語句 SQL + 依序排好的值陣列）。
- 只支援**值位置**參數，一律走 mysql2 預備語句綁定，**絕不字串拼接**——因此免疫 SQL injection、不可能破壞 read-only 保證。
- 不支援動態表名/欄名、`IN (...)` 多選清單、可選子句樣板（Out of Scope）。
- 缺必填值、型別不符、SQL 引用了未宣告的參數 → 這個純函式回報明確錯誤，執行路徑據以擋下。
- `date_range` 展開為兩個綁定值（起、訖）。

**執行與護欄**
- Report 執行走 `analyticsPool()`（read-only replica/帳號），沿用既有 `isReadOnly` belt（單句、`select`/`with` 開頭）、敏感欄位黑名單（執行前後）。這些對手寫 SQL **照樣全套適用**。
- **兩段式列上限**：畫面預覽用較低上限（沿用/接近現有 `GUARDRAIL_MAX_ROWS`）；匯出走**獨立執行路徑**、用較高上限（新設定 `REPORT_EXPORT_MAX_ROWS`，仍有帽子避免 OOM）。報表另有自己的 `REPORT_MAX_ROWS` 與 `REPORT_STATEMENT_TIMEOUT_MS`。
- 擴充既有 `enforceRowLimit`（`lib/guardrails.ts`）使其接受呼叫端指定的上限（預覽 vs 匯出），沿用它現有的 CTE/derived-table 包裝邏輯（測試 seam #5，既有 seam 優先）。
- `executeGuarded` 需支援帶 bind 參數執行（目前只吃 SQL 字串）。

**AI 升格路徑**
- 在既有 AI 結果上提供「升格為報表」動作：複製該次的 `query_sql` 與 `chart_spec` 建立一張新 `report`。升格後的 SQL 可再由 Editor 加上參數。沿用 `saved_query` 既存的 SQL + chart_spec，不新增產圖邏輯。

**輸出與匯出**
- 圖沿用既有確定性渲染（`ChartSpec` + rows → ECharts）。RD 手動指定 chart spec，沿用既有「引用欄位須存在於結果欄位」的驗證才給存。**不呼叫 LLM**。
- 匯出 v1 = **CSV + UTF-8 BOM**，可串流；序列化為純函式（測試 seam #3）。圖 PNG 匯出用 ECharts `getDataURL()`。

**角色（ADR-0004）**
- `users` 加一個 `role` enum 欄位（`super_admin` / `editor` / `viewer`），單一角色、上位涵蓋下位。種子帳號 `admin@gmail.com` 設為第一個 `super_admin`。
- 授權以一個**純述詞** `can(role, action)` 表達（測試 seam #4），供路由與 UI 共用；`authorized()` / 路由需接上角色 gating（目前僅檢查登入）。
- 關鍵理由（記入 ADR）：手寫 SQL 不是資料存取升級（與 AI SQL 同一護欄），角色是為**治理**。

**設定中心（ADR-0005）**
- 新增 `setting` 表 + 設定服務；解析優先序 **DB → env → 內建預設**（純解析器，測試 seam #2a）。搬進 DB：護欄上限/timeout、報表上限、黑名單、`ANALYTICS_SCHEMAS`、LLM provider + 模型名、分析庫連線 + LLM 金鑰。`.env` 只留 **state DB 連線** 與 **`AUTH_SECRET`**。
- **祕密設定**（分析庫密碼、LLM 金鑰）加密存放：AES-GCM，金鑰取自新的 `.env` 變數（或衍生自 `AUTH_SECRET`），只在記憶體解密，UI 上 masked/write-only（測試 seam #2b：加解密 round-trip）。
- **熱重載**：`analyticsPool()` 與 LLM provider 目前於開機時從 env 建立，需改為可在 Super Admin 變更相關設定時重建，不必重啟。
- **初始設定精靈**：全新安裝（DB 尚無設定）時，引導 Super Admin 填入連線與金鑰後才可用。

**導覽 / UI**
- 頂欄新增「報表」頂層區塊，與現有「儀表板(AI)」「語意層管理」平行；另加只有 Super Admin 可見的「使用者」「系統設定」。
- 報表區三種視圖：清單（所有角色）、執行（所有角色）、建立/編輯（Editor 以上）。
- Report 與 AI 累積式儀表板完全分開，不互相釘選（grilling Q11 選 A）。

**建置順序（建議分階段）**
1. 角色 + 設定中心（其他一切的地基）。
2. Report CRUD + 參數綁定 + 執行。
3. 匯出（CSV/PNG）+ AI 升格。

## Testing Decisions

好的測試只驗**外部行為**、不綁實作細節；沿用專案既有慣例——把安全/正確性關鍵邏輯抽成**純函式**，用 vitest 在最高、最少的 seam 上測，DB / LLM / HTTP / UI 一律不進單元測試。

**要測的 seam（純函式）：**
1. **參數綁定** — 輸入（SQL 模板、參數宣告、填入值）→ 輸出（預備語句 SQL + 有序值陣列）。涵蓋：正常綁定、`date_range` 展開為兩值、型別不符被擋、缺必填值被擋、SQL 引用未宣告參數被擋、確認輸出永遠是綁定值而非拼接字串。
2a. **設定解析器** — DB/env/預設三來源依優先序解析 + 型別轉換（數字、清單、布林）。
2b. **祕密加解密** — AES-GCM round-trip：加密後密文與明文不同、以正確金鑰解密可還原、錯誤金鑰無法還原。
3. **CSV 匯出序列化** — columns+rows → CSV：UTF-8 BOM 前綴、含逗號/雙引號/換行的值正確跳脫、null/undefined 處理、欄位順序穩定。
4. **授權述詞** `can(role, action)` — Viewer 不能建/編/刪報表、Editor 不能管使用者或改設定、Super Admin 全可、上位涵蓋下位。
5. **列上限**（既有 seam，擴充 `enforceRowLimit`）— 預覽上限與匯出上限分別套用；沿用既有 CTE vs derived-table 包裝的既有測試心法。

**測試 prior art：** 沿用 `lib/knowledgeInput.test.ts`、`lib/schema/relationshipGraph.test.ts`、`lib/llm/prompts.test.ts`、`lib/llm/learn.test.ts` 的純函式單元測試風格（vitest、node 環境、`**/*.test.ts`）。

**明確不寫單元測試**（維持專案慣例，靠既有護欄 + 手動驗證 / VERIFICATION.md）：連線池與 provider 熱重載、Next.js 路由的角色 gating、report CRUD 的 DB 持久化、setup 精靈與各頁 UI、實際的 mysql2 綁定執行 round-trip。

## Out of Scope

- 報表的版本歷史、稽核、草稿/發佈兩態（v1 即時生效、無版本；grilling Q13 選 A）。
- 動態結構參數：可換表名/欄名、`IN (...)` 多選清單、可選子句樣板（只做值位置的預備語句綁定）。
- 從另一條查詢動態生成的下拉選單（enum 僅支援 RD 寫死的固定清單）。
- 原生 Excel（.xlsx）匯出（v1 只做 CSV+BOM；xlsx 之後再加）。
- 把報表結果釘進 AI 累積式儀表板 / 報表以磚塊長在儀表板上（兩個世界保持分開）。
- 報表的分類/資料夾/搜尋等組織功能（v1 只有平面清單）。
- 每張報表的細粒度擁有權（哪個 Editor 能編哪張）——先用全域角色，之後可疊加。
- RD 手寫報表的 AI 輔助建圖（v1 純手動指定 chart spec）。
- 報表排程 / 週期快照（grilling Q1 的 D 選項，未選）。
- 語意層 / Table Catalog 編輯權是否收斂到 Editor 以上——ADR-0004 標為待確認，不在本 PRD 動工。

## Further Notes

- 本次範圍比原始一句話需求（「加報表 + RD 提供 SQL」）大很多：連帶引入了**角色系統**與**設定中心**兩個橫切子系統。三者相依，建議照上述三階段建置，角色 + 設定中心先行。
- 安全立場（記入 ADR-0004）：Editor 手寫 SQL 與 AI 產生的 SQL 走**完全相同**的護欄，因此手寫 SQL 不是資料存取的權限升級；角色的意義在治理（誰能發佈給別人用），不在防資料外洩。
- 祕密進 DB 是相對 `.env` 的安全退步，靠 AES-GCM 加密 + write-only UI 補回（ADR-0005）。切勿以明文存 `setting`。
- 參數只過濾「列」不改「欄」，所以一份 chart spec 一次設好後、不論營運端填什麼參數都仍然有效，不需每次重算欄位映射。
- 相關詞彙以 `CONTEXT.md` 為準：Report、Report Parameter、Role、Setting / Secret Setting、Trusted Query、Saved Chart。實作時勿在程式碼用 "RD"/"ops" 字樣，一律用角色名（editor/viewer）。
