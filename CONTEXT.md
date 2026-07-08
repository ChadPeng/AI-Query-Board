# QueryBoard

An internal analytics tool: users ask data questions in natural language; the AI generates read-only SQL against an existing MySQL database, runs it, and renders a chart. This glossary pins the domain language so terms don't drift across the codebase.

## Language

**Semantic Layer**:
The body of human-authored business knowledge that teaches the AI how to correctly query this specific database — the meaning of codes, metrics, filters, and table relationships that the raw DDL cannot express. Distinct from the Table Catalog (which only says what a table _is_).
_Avoid_: rule memory, knowledge base, memory

**Semantic Rule**:
One entry in the Semantic Layer. Has a **scope** (where it applies) plus **free-text content** (the rule itself). Human-reviewable, like Table Catalog entries.
_Avoid_: rule, memory, note

**Relationship**:
A structured, human-authored join edge between two tables that the raw DDL doesn't declare (the real DB has no FK constraints). Authored once as a directed edge `from_table.from_col → to_table.to_col` plus a **cardinality**; the reverse direction is derived. Lives alongside the Semantic Layer but is structured, not free-text, because joins are mechanical and verifiable.
_Avoid_: foreign key, association, join hint

**Cardinality**:
The multiplicity of a Relationship — `many-to-one`, `one-to-one`, or `many-to-many`. Tells the SQL generator when a `GROUP BY` is needed (a `user` has many `orders`).

**Rule Scope**:
Where a Semantic Rule applies, which also decides when it's injected: **Global** (cross-cutting, e.g. "amounts are in cents"; always injected) · **Term** (a named business concept, e.g. "creator = user with is_creator=1"; always injected so it can steer table selection) · **Table** (bound to one table, e.g. a status code dictionary; injected only when that table is selected).

**Reviewed**:
The human-confirmed state of a Semantic Rule, Relationship, or Table Catalog entry. AI-bootstrapped drafts start un-reviewed; they are still fed to the LLM but marked "unconfirmed" until a human confirms them.

**Table Catalog**:
The AI-bootstrapped, human-corrected one-line-per-table index used for stage-1 table selection. Answers "what is this table?", not "how do I query it correctly?" — the latter is the Semantic Layer's job.
_Avoid_: schema catalog, table index

**Trusted Query**:
A confirmed question→SQL pair saved for reuse (the #3 flywheel, `saved_query` table). NOT part of the Semantic Layer — it reuses a whole answer; the Semantic Layer teaches the AI to generate new ones.
_Avoid_: saved query memory

**Saved Chart**:
A chart snapshot a user has kept (`pinned_charts` row: spec + data + SQL). It is in one of two states — **On-board** (shown on the dashboard grid) or **Stashed** (kept in the collection tray, off the board). Pin/unpin toggles between the two; only an explicit delete discards the snapshot.
_Avoid_: pinned chart (ambiguous now — a Saved Chart may be off the board)

**Conversation**:
The prior turns of a chat, fed back for follow-up questions. NOT part of the Semantic Layer.
_Avoid_: history memory

**Report**:
A named, reusable query artifact published for the operations team to run on demand. Authored two ways: an engineer writes raw SQL directly, or a good AI-generated result is promoted (its SQL + chart spec copied into a new Report). When run, it executes live under the same read-only guardrails and renders results as a **table** (exportable to CSV/Excel) and/or a **chart**. May declare **parameters** (e.g. a date range) that the runner fills in at run time. Distinct from a Trusted Query (an invisible per-user reuse cache matched by paraphrase during AI chat) and from a Saved Chart (a static data snapshot that never re-runs).
_Avoid_: trusted query, saved query, dashboard, canned query

**Report Parameter**:
A named, typed input declared on a Report and bound into its SQL at run time (e.g. `:start_date`). Filled in by whoever runs the Report. Types: date / date-range, number, text, and fixed-list enum. Bound as a real prepared-statement parameter, never string-concatenated, so it cannot break the read-only guarantee.
_Avoid_: filter, variable, argument

**Role**:
A user's single authorization tier; higher tiers include everything lower tiers can do. **Super Admin** — the only one who manages users + role assignment and edits system Settings. **Editor** — the "RD"; authors and edits Reports, writes raw SQL, declares parameters and chart specs. **Viewer** — the "operations" user; runs Reports, fills parameters, views, and exports, but cannot author. Before this feature the app had no roles — any authenticated user could do anything.
_Avoid_: permission, group; don't say "RD"/"ops" in code — use the role name

**Setting**:
A runtime-editable system configuration value stored in the state DB, overriding the `.env` default (precedence: **DB → env → built-in default**). Only a Super Admin edits Settings, and changes apply without a restart. A **Secret Setting** (analytics-DB and LLM credentials) is encrypted at rest and write-only in the UI (masked, never read back). Only the state-DB connection and `AUTH_SECRET` stay exclusively in `.env`.
_Avoid_: config, env var, preference
