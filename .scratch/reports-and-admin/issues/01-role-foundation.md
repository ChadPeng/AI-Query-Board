# 01 — 角色地基（Role foundation）

Status: done

> Completed 2026-07-06. 純授權核心 `lib/auth/permissions.ts`（rank-based `can(role,action)`，
> edge-safe，中介層/API/UI 共用）+ 6 個單元測試。`users` 加 `role` enum（既有列預設
> viewer），setup script 冪等把 admin@gmail.com 升 super_admin。role 經 authorize→JWT→
> session 傳遞；`authorized()` gate `/admin` + `/api/admin` 給 super_admin（頁面轉首頁、
> API 回 403）。`lib/apiAuth.ts` 加 currentUser()/authorizeAction()。使用者管理 API
> （list + set role，含防自我降級）+ 頁面 app/admin/users + 導覽依角色顯示入口。
> typecheck 乾淨、31/31 測試通過、next build 編譯成功。順手修了既有壞掉的
> scripts/test-query-generation.ts（generateSql→generateSqlAndChart）。
> NOT verified（無 state DB）：登入帶 role、middleware 實擋、改角色寫回 DB 的整合 round-trip。

## Parent

`.scratch/reports-and-admin/PRD.md`（見 `docs/adr/0004-user-roles.md`）

## What to build

引入三層 **Role**（`super_admin` / `editor` / `viewer`），單一角色、上位涵蓋下位。這是一條端到端切片：資料模型加角色、產生純粹的授權述詞、把路由與導覽依角色 gate 起來。

- `users` 新增 `role` 欄位；種子帳號 `admin@gmail.com` 設為第一個 `super_admin`；既有其他帳號給合理預設（`viewer` 或 `editor`，擇一並在 PRD 精神下註記）。
- 抽出一個**純述詞** `can(role, action)`：表達「Viewer 只能跑、Editor 能建/編/刪報表與寫 SQL、Super Admin 另可管使用者與系統設定」，且上位涵蓋下位。路由與 UI 都用它，不要各自寫死判斷。
- `authorized()` / API 路由接上角色 gating（目前僅檢查是否登入）。
- 導覽依角色顯示：所有人可見「報表」；Editor 以上可見報表的建立/編輯入口；只有 Super Admin 可見「使用者」「系統設定」入口。
- 一個最小的「使用者管理」頁（僅 Super Admin），能指派角色。

安全理由（記入 ADR-0004）：手寫 SQL 與 AI 產生的 SQL 走相同護欄，角色是為**治理**（誰能發佈）不是防資料外洩。

## Acceptance criteria

- [ ] `users` 具備 `role`，`admin@gmail.com` 為 `super_admin`
- [ ] `can(role, action)` 為純函式並有單元測試：Viewer 不能建/編/刪報表、Editor 不能管使用者或改系統設定、Super Admin 全可、上位涵蓋下位
- [ ] Viewer 直接打 Editor-only 或 Super-Admin-only 的路由會被擋
- [ ] 導覽依角色正確顯示/隱藏入口
- [ ] Super Admin 能在使用者管理頁指派角色

## Blocked by

None - can start immediately
