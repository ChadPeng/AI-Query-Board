# 02 — 設定中心骨架（Settings center skeleton）

Status: done

> Completed 2026-07-07. 純解析器 lib/settings/resolve.ts：coerceSetting（number/boolean/
> list/string，非法回 ok:false）+ resolveSetting（DB→env→default 依序取第一個能 coerce 的、
> 回 value+source），8 個單元測試（含跳過非法來源、空字串 list 覆寫）。setting 表
> （setting_key PK / setting_value / updated_by / updated_at）+ lib/state/settings.ts
> （getSettingOverrides/upsert/delete）。registry.ts 宣告設定（本片先納入 report.max_rows）。
> service.ts：5s TTL 快取（寫入即失效→免重啟）、getSetting/getNumberSetting/listSettings
> （祕密值遮罩，預留 03）/setSetting（存前 coerce 驗證、null=還原）。**端到端**把
> report.max_rows 從常數改成 run route 的 await getNumberSetting('report.max_rows')。
> API：GET/PATCH /api/admin/settings（setting:manage，middleware 已 gate /api/admin）。
> 頁：app/admin/settings 顯示每項的目前值+來源（DB覆寫/.env/內建）、可覆寫與還原。導覽加
> 「設定」入口（super_admin）。typecheck 乾淨、77/77 測試、build 全綠。
> NOT verified（state DB 內網）：setting 表 DDL、改值即時生效的 end-to-end。

## Parent

`.scratch/reports-and-admin/PRD.md`（見 `docs/adr/0005-db-backed-settings-and-encrypted-secrets.md`）

## What to build

建立 **Setting** 機制的端到端骨架，並用**一個非祕密設定**貫穿驗證（先不碰祕密與連線，那是 03）。

- 新增 `setting` 表（key / 值 / 改動者 / 時間）與設定服務。
- **純解析器**：依優先序 **DB → env → 內建預設** 解析出設定值，並做型別轉換（數字、清單、布林）。
- 挑一個既有的非祕密營運參數當示範，端到端搬進來（建議：預覽列上限 `GUARDRAIL_MAX_ROWS`，或報表預覽上限）。讀取端改為向設定服務取值，而非直接讀 `process.env`。
- Super Admin 專屬的「系統設定」頁，能檢視與覆寫此設定；顯示目前值的**來源**（DB 覆寫 or env 預設）。
- 變更**即時生效**（讀取端每次向服務取值，或服務具快取失效機制），不需重啟。

## Acceptance criteria

- [ ] `setting` 表與設定服務就緒
- [ ] 解析器為純函式並有單元測試：DB 值優先、無 DB 值退 env、再退內建預設、型別轉換正確
- [ ] Super Admin 在設定頁改該值後，行為即時反映（免重啟），非 Super Admin 看不到此頁
- [ ] UI 顯示每個設定值的來源（DB 覆寫 / env 預設）

## Blocked by

- 01 — 角色地基（需要 Super Admin 角色與 gating）
