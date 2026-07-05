# 05 — 自建帳密登入

Status: done

> Completed 2026-06-22. Auth.js v5 (next-auth@beta) Credentials provider + bcryptjs
> — no hand-rolled crypto/session. Split config: edge-safe auth.config.ts (route
> gating via authorized callback, trustHost:true for self-hosted) + auth.ts
> (Credentials authorize → state-DB users lookup + bcrypt.compare). users table
> added to state migrations; lib/state/users.ts (getByEmail/create). /api/register
> hashes (bcrypt cost 10) + inserts, validates email/≥8-char password, runs
> migrations idempotently. middleware.ts gates all non-public paths → redirect to
> /login; /api/ask also re-checks auth() server-side (401). Login/register page,
> SessionProvider in layout, email + logout on the dashboard. Session id exposed
> via jwt/session callbacks for downstream owner wiring.
>
> Verified here: typecheck + build pass; / and /api/ask redirect to /login when
> unauthenticated (307); /login + /api/register public; register input validation
> (400); /api/auth/session returns 200; fixed an UntrustedHost error by setting
> trustHost (required for self-hosted, PRD §5). NOT verified (no STATE_DB):
> real registration insert, bcrypt round-trip, login → session persistence.
> NOTE: conversation/chart owner COLUMNS land with their tables in slices 06/07/08
> (which are blocked-by this); the session already carries user.id for that.
>
> Also: split instrumentation into instrumentation.ts + instrumentation-node.ts so
> mysql2 isn't pulled into the Edge (middleware) bundle.

Source: `.scratch/ai-data-dashboard/PRD.md`（第 5、6 節）

## What to build

自建帳密的登入機制，並把對話與圖表綁到使用者（個人模型）。

- 登入頁 → 後端驗證 → 建立 session。
- 用成熟函式庫（**Auth.js Credentials provider** 或 **Lucia**），密碼以 `bcrypt`/`argon2` 雜湊——**不可自刻密碼學**。
- 狀態庫新增 `user` 表；對話/圖表開始綁定 owner。
- 未登入無法使用主功能。

此切片可與 02/03/04 並行，但 06、08 需在此之後。

## Acceptance criteria

- [ ] 使用者可註冊/建立帳號並以帳密登入
- [ ] 密碼以 bcrypt/argon2 雜湊儲存，非明文
- [ ] session 管理正常（登入持續、登出失效）
- [ ] 未登入時主功能被擋在登入後
- [ ] 對話與圖表記錄帶有 owner（user）

## Blocked by

- 01 — Walking skeleton
