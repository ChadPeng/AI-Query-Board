# QueryBoard

內部分析工具：用自然語言問數據問題，AI 產生 SQL 查詢現有 MySQL，並把結果畫成可累積的儀表板圖表。

## ✨ 核心功能

- **🤖 AI Text-to-SQL**：自然語言轉 SQL，支援複雜查詢和多表 JOIN
- **📊 智慧圖表生成**：自動選擇最適合的圖表類型（柱狀圖、折線圖、圓餅圖、表格等）
- **💬 對話追問**：支援上下文追問，記住對話歷史
- **📌 累積式儀表板**：將確認正確的圖表釘選到儀表板，逐步建立個人分析看板
- **🧠 語意層（Semantic Layer）**：
  - 表目錄（Table Catalog）：AI 輔助建立表格說明，提升檢索準確度
  - 語意規則（Semantic Rules）：教 AI 理解業務術語和計算邏輯
  - 關係圖譜（Relationships）：定義表間關係，自動生成正確的 JOIN
  - Learn from SQL：從現有 SQL 自動學習並建立語意規則
- **📚 可信查詢庫**：保存確認正確的問句→SQL 配對，優先重用
- **🛡️ 技術護欄**：
  - 唯讀帳號驗證、強制 LIMIT、statement timeout
  - 敏感欄位黑名單、SQL 透明展示
- **🔐 帳密登入**：自建認證系統（NextAuth + bcrypt）
- **🎨 知識庫管理介面**：視覺化管理表目錄、規則、關係圖譜

> 📖 完整規格見 [PRD](.scratch/ai-data-dashboard/PRD.md)，開發紀錄見 [issues](.scratch/ai-data-dashboard/issues/)。

## 🛠️ 技術棧

- **Next.js 15 / React 19 / TypeScript**（App Router）
- **ECharts**：圖表渲染
- **mysql2**：連線兩個獨立的 MySQL
  - `ANALYTICS_DB` — 被查詢的**現有** DB，**唯讀**（建議連 replica、用 SELECT-only 帳號）
  - `STATE_DB` — app 自己的 DB，**讀寫**（存對話/儀表板/可信查詢/表目錄/語意層）
- **LLM 支援**：Claude（Anthropic）、Gemini（Google）、OpenAI-compatible API

## 🚀 快速開始

### 1. 安裝相依套件

```bash
npm install
```

### 2. 設定環境變數

```bash
cp .env.example .env
```

編輯 `.env`，填入以下必要資訊：

```env
# LLM Provider（選擇一個）
LLM_PROVIDER=gemini              # 或 claude, openai-compat
GEMINI_API_KEY=your_key          # 如果用 Gemini
ANTHROPIC_API_KEY=your_key       # 如果用 Claude

# NextAuth
AUTH_SECRET=your_secret          # 執行 `npx auth secret` 產生

# 分析資料庫（唯讀）
ANALYTICS_DB_HOST=localhost
ANALYTICS_DB_PORT=3306
ANALYTICS_DB_USER=readonly_user
ANALYTICS_DB_PASSWORD=password
ANALYTICS_DB_DATABASE=your_db

# 狀態資料庫（讀寫）
STATE_DB_HOST=localhost
STATE_DB_PORT=3306
STATE_DB_USER=readwrite_user
STATE_DB_PASSWORD=password
STATE_DB_DATABASE=queryboard_state
```

### 3. 初始化狀態資料庫

```bash
npm run setup:state              # 建立表結構
npm run bootstrap:catalog        # AI 自動產生表目錄（可選）
npm run bootstrap:semantics      # AI 自動產生語意規則（可選）
```

### 4. 啟動開發伺服器

```bash
npm run dev                      # http://localhost:3000
```

### 5. 註冊並開始使用

1. 訪問 `http://localhost:3000`
2. 點擊「建立帳號」註冊
3. 登入後即可在右側對話框提問
4. 確認正確的圖表可釘選到左側儀表板

## 📝 其他指令

```bash
npm run build                    # Production build
npm start                        # 啟動 production server
npm run typecheck                # TypeScript 型別檢查
npm test                         # 執行測試
npm run setup:state              # 初始化狀態資料庫結構
npm run bootstrap:catalog        # AI 產生表目錄
npm run bootstrap:semantics      # AI 產生語意規則
```

## 🗄️ 資料庫架構

QueryBoard 使用兩個**獨立**的 MySQL 資料庫：

### ANALYTICS_DB（分析庫，唯讀）
- 你的**現有資料庫**，被 AI 查詢的目標
- **必須使用唯讀帳號**（建議連 replica）
- 啟動時會驗證帳號權限，若有寫入權限會發出警告

### STATE_DB（狀態庫，讀寫）
- QueryBoard 自己的資料庫
- 存儲：
  - 使用者帳號（`users`）
  - 對話歷史（`conversations`, `turns`）
  - 儀表板和圖表（`dashboards`, `pinned_charts`）
  - 可信查詢庫（`saved_queries`）
  - 表目錄（`table_catalog`）
  - 語意層（`semantic_rules`, `relationships`）

## 🔒 安全設計

**技術層防護**（已實作）：
- ✅ **唯讀帳號驗證**：啟動時檢查 ANALYTICS_DB 帳號權限
- ✅ **強制 LIMIT**：後端自動注入行數限制（預設 5000）
- ✅ **Statement Timeout**：查詢超時自動終止（預設 30 秒）
- ✅ **敏感欄位黑名單**：阻止查詢包含 `password`、`secret` 等敏感欄位
- ✅ **SQL 透明展示**：每張圖都顯示生成的 SQL，可人工審核
- ✅ **連線 Replica**：建議連唯讀副本，避免影響主庫

**語意層緩解**：
- 表目錄和語意規則提升 SQL 準確度
- 可信查詢庫累積確認正確的查詢
- 人工審核機制：釘選前可檢視 SQL

## 🌐 API 端點

| 端點 | 說明 |
|---|---|
| `POST /api/ask` | AI 對話：自然語言 → SQL + 圖表 |
| `GET /api/conversation` | 取得對話列表 |
| `POST /api/conversation` | 建立新對話 |
| `GET /api/dashboard` | 取得使用者的儀表板列表 |
| `POST /api/dashboard` | 建立新儀表板 |
| `GET /api/dashboard/[id]` | 取得特定儀表板及其圖表 |
| `GET /api/knowledge` | 知識庫概覽 |
| `GET/POST /api/knowledge/tables` | 表目錄管理 |
| `GET/POST /api/knowledge/rules` | 語意規則管理 |
| `GET/POST /api/knowledge/relationships` | 關係圖譜管理 |
| `POST /api/knowledge/learn` | 從 SQL 學習語意規則 |
| `POST /api/register` | 註冊新帳號 |
| `GET /api/health` | 健康檢查（兩個資料庫連線狀態） |

## 🧪 驗證清單

首次部署後建議執行的檢查：

- [ ] 訪問 `/api/health`，確認兩個資料庫都連線成功
- [ ] 檢查啟動 log，確認 ANALYTICS_DB 顯示 `read-only ✓`
- [ ] 註冊帳號並登入
- [ ] 提問測試（例如：「列出所有資料表」）
- [ ] 檢視生成的 SQL 是否合理
- [ ] 釘選圖表到儀表板
- [ ] 測試對話追問功能
- [ ] 訪問 `/knowledge` 管理知識庫

詳細驗證步驟見 [VERIFICATION.md](.scratch/ai-data-dashboard/VERIFICATION.md)。

## 📚 文件

- **[PRD（產品需求文件）](.scratch/ai-data-dashboard/PRD.md)**：完整功能規格
- **[CONTEXT.md](CONTEXT.md)**：領域術語詞彙表
- **[VERIFICATION.md](.scratch/ai-data-dashboard/VERIFICATION.md)**：部署後驗證清單
- **[Issues](.scratch/ai-data-dashboard/issues/)**：開發紀錄和技術決策
- **[ADR（架構決策記錄）](docs/adr/)**：重要設計決策
- **[Agent 文件](docs/agents/)**：AI Agent 使用指南

## 📁 專案結構

```
├── app/                      # Next.js App Router
│   ├── api/                  # API 路由
│   │   ├── ask/              # AI 對話端點
│   │   ├── dashboard/        # 儀表板管理
│   │   ├── knowledge/        # 知識庫管理
│   │   └── ...
│   ├── components/           # React 元件
│   ├── knowledge/            # 知識庫管理介面
│   └── login/                # 登入頁面
├── lib/                      # 核心邏輯
│   ├── engine.ts             # AI text-to-SQL 引擎
│   ├── guardrails.ts         # 安全護欄
│   ├── llm/                  # LLM Provider 抽象層
│   ├── schema/               # Schema 檢索和關係圖譜
│   └── state/                # 狀態資料庫存取層
├── scripts/                  # 管理腳本
│   ├── setup-state-db.ts     # 初始化狀態庫
│   ├── bootstrap-catalog.ts  # 自動產生表目錄
│   └── bootstrap-semantics.ts # 自動產生語意規則
├── docs/                     # 文件
│   ├── adr/                  # 架構決策記錄
│   └── agents/               # Agent 使用指南
└── .scratch/                 # PRD 和開發紀錄
```

## 🤝 貢獻

這是內部工具專案。如有問題或建議，請建立 issue。

## 📄 授權

內部使用專案，未公開授權。
