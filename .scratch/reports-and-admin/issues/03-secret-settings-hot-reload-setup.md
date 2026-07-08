# 03 — 祕密設定＋熱重載＋初始精靈（Secret Settings, hot reload, first-run setup）

Status: done

> Completed 2026-07-07（含對真 DB 的整合驗證）。
> **加密**：lib/settings/crypto.ts AES-256-GCM（金鑰取 SETTINGS_ENCRYPTION_KEY 或衍生自
> AUTH_SECRET），6 個單元測試（round-trip/錯誤金鑰/竄改偵測/未加密拒絕）。設定服務 secret-aware：
> 寫入加密、讀取解密、listSettings 遮罩。
> **搬進 settings**：registry 新增 analytics.host/port/user/password(secret)/database/schemas
> 與 llm.provider＋各家 key(secret)/model；config.ts 解析（DB→env→default 已內含 env）。
> **熱重載**：db.ts ensureAnalyticsPool（config 簽章比對，變更即 dispose+重建）；executeGuarded
> 改用它 → 引擎與所有報表路由自動吃設定＋熱重載。factory.getActiveProvider（簽章快取，provider/
> 金鑰/模型變更即重建）；engine 改 await getActiveProvider()。verifyConnections 也走 ensure。
> **setup 精靈**：/api/setup/status（布林、無祕密）＋ app/admin/setup（分析庫＋provider 引導表單，
> 沿用設定 PATCH，祕密留空＝不變更）＋ 儀表板未設定橫幅（super_admin 給連結）。
> **.env 精簡**：連線/金鑰皆可改由 DB 覆寫，.env 僅需 state DB 連線＋AUTH_SECRET（其餘為 fallback）。
> **活 DB 煙霧測試全過**：連線熱重載（壞 host→重建失敗→還原恢復）、provider 熱切換（groq↔gemini）、
> 祕密存 DB 為 enc:v1: 密文且能解密還原、測試 override 全數還原。typecheck 乾淨、83/83 單元測試、
> next build 全綠。setup-state-db.ts 順手改成「無 CREATE DATABASE 權限但庫已存在」時略過建庫。

## Parent

`.scratch/reports-and-admin/PRD.md`（見 `docs/adr/0005-db-backed-settings-and-encrypted-secrets.md`）

## What to build

把設定搬進 DB「搬到極限」：分析庫連線與 LLM 金鑰等**祕密設定**進 DB（加密），並讓它們能被 Super Admin 即時改、即時生效，全新安裝也能從零設定起來。`.env` 只保留 **state DB 連線** 與 **`AUTH_SECRET`**。

- **Secret Setting**：新增「祕密」型設定，值以 **AES-GCM 加密**後才寫進 `setting`，金鑰取自新的 `.env` 變數（或衍生自 `AUTH_SECRET`），只在記憶體解密。UI 上祕密為 **masked / write-only**（能覆寫、不回顯）。
- 搬入的祕密/連線：分析庫連線（`ANALYTICS_DB_*`）、LLM 金鑰；連同非祕密的 `ANALYTICS_SCHEMAS`、`LLM_PROVIDER` 與模型名一併納入設定服務。
- **熱重載**：`analyticsPool()` 與 LLM provider 目前於開機時從 env 建立，改為可在 Super Admin 變更相關設定時重建，不必重啟。
- **初始設定精靈**：全新安裝（`setting` 尚無必要設定）時，引導 Super Admin 填入分析庫連線與 LLM 金鑰後系統才可用。

切勿以明文存祕密（ADR-0005）。

## Acceptance criteria

- [ ] Secret Setting 加密存放；加解密為純函式並有單元測試（round-trip 還原、錯誤金鑰無法還原、密文≠明文）
- [ ] UI 上祕密為 masked/write-only，無法讀回明文
- [ ] Super Admin 改分析庫連線或 provider 後，連線池/provider 熱重載、免重啟即生效
- [ ] 全新安裝時 setup 精靈能引導填入連線與金鑰，之後系統可正常查詢
- [ ] `.env` 僅剩 state DB 連線與 `AUTH_SECRET` 為必要項

## Blocked by

- 02 — 設定中心骨架
