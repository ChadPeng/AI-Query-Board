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
