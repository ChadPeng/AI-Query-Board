# 05 — 報表參數（Report Parameters）

Status: done

> Completed 2026-07-07. 安全核心 lib/reports/params.ts（純）：bindReportSql —— 手寫的
> tokenizer 掃過 SQL、跳過字串字面值/註解/backtick，只把宣告過的 :name 換成 ?、把值依序
> 收進陣列（date_range → :name_start/:name_end 兩值）；未宣告的 :placeholder、型別不符、
> 缺必填、enum 非法值、起訖顛倒都回明確錯誤；值永不進 SQL 字串。normalizeParams 驗證宣告
> （名稱/型別/enum 選項/重複）。18 個單元測試（含「字串字面值裡的 :word / '12:00' 不被當
> 佔位符」的注入防護）。report 加 params JSON 欄；reports.ts 存讀 JSON；parseReportInput
> 併驗 params。executeGuarded/runGuardedQuery 吃 values：有值時走 conn.execute（真預備語句）。
> run route 收 body.values → bindReportSql → 執行、回 applied。UI：編輯器加參數宣告列
> （名稱/型別/標籤/enum選項/預設/必填），執行頁依型別渲染表單（date/區間雙欄/number/text/
> enum 下拉）。typecheck 乾淨、55/55 測試、build 全綠。
> NOT verified（state DB 內網 ETIMEDOUT）：真 MySQL 上 conn.execute 綁定執行、參數表單→
> 綁定→結果的 end-to-end。

## Parent

`.scratch/reports-and-admin/PRD.md`

## What to build

讓 Report 可宣告 **Report Parameter**，Viewer 執行時填一張表單，值以**預備語句綁定**塞進 SQL——絕不字串拼接。這是整個功能的安全核心。

- Editor 在 SQL 用具名佔位符（例如 `:start_date`）宣告參數，並替每個參數指定：型別（`date` / `date_range` / `number` / `text` / `enum`）、顯示標籤、預設值、enum 的固定選項清單。
- **參數綁定純函式**：輸入（SQL 模板、參數宣告、使用者填入值），輸出（mysql2 預備語句 SQL ＋ 依序排好的值陣列）。`date_range` 展開為起訖兩個綁定值。缺必填值、型別不符、SQL 引用未宣告參數 → 回報明確錯誤。
- `executeGuarded` 支援帶 bind 參數執行（目前只吃 SQL 字串）。
- Viewer 執行頁呈現參數表單；enum 呈現為下拉、只能選允許值；未填必填參數給清楚提示。執行後顯示當前套用的參數值。
- 只支援值位置參數（不做動態表名/欄名、`IN(...)` 多選、可選子句樣板）。

## Acceptance criteria

- [ ] 參數綁定為純函式並有單元測試：正常綁定、`date_range` 展開兩值、型別不符被擋、缺必填被擋、引用未宣告參數被擋、輸出恆為綁定值而非拼接字串
- [ ] Viewer 能填參數表單並執行；enum 為下拉且限允許值；缺必填有提示
- [ ] 執行結果反映所填參數；畫面顯示當前參數值
- [ ] `executeGuarded` 能以 bind 參數執行，read-only 與護欄不變

## Blocked by

- 04 — 報表核心
