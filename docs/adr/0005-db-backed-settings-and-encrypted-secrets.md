# Move configuration into a DB-backed Settings store, with secrets encrypted at rest

Configuration was previously `.env`-only, which is inflexible: tuning a row cap, timeout, blacklist, or schema list meant editing env and restarting. We are moving configuration into a `setting` table in the state DB that a Super Admin edits at runtime (no restart). Resolution precedence is **DB value → `.env` default → built-in default**, so `.env` degrades from "the source of truth" to "the bootstrap default". We move as much as possible into the DB — guardrail limits, report limits, blacklists, `ANALYTICS_SCHEMAS`, the LLM provider + model names, and even the analytics-DB / LLM connection details. Only the **state-DB connection** (needed to read Settings at all — a chicken-and-egg) and **`AUTH_SECRET`** stay exclusively in `.env`.

## Secrets

Moving credentials (analytics-DB password, LLM API keys) into the DB is a real security regression versus `.env`: anyone with a state-DB dump/backup would see plaintext secrets. So a **Secret Setting** is encrypted at rest (AES-GCM) with a key taken from a new `.env` variable (or derived from `AUTH_SECRET`), decrypted only in memory, and is write-only in the UI (masked, never read back). This buys back the exposure that moving secrets into the DB would otherwise create.

## Considered alternatives

- **Only non-secret tunables in the DB; keep all secrets in `.env`.** Rejected because we want a single settings surface and a first-run setup flow that configures connections too — but this remains the fallback if encryption proves troublesome.
- **Plaintext secrets in the DB** ("it's an internal intranet tool"). Rejected: violates least-disclosure and turns every backup into a secret leak, for no real saving over encrypting.

## Consequences

- The analytics-DB **connection pool** and the **LLM provider** are built at startup from `.env` today; they must become rebuildable when a Super Admin changes the relevant Settings (hot reload), rather than requiring a restart.
- A fresh install has no analytics DB / LLM configured, so a **first-run setup wizard** is required for the Super Admin to enter connections and keys before the app is usable.
