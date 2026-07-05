# Semantic Layer retrieval and injection

The Semantic Layer teaches the AI to query correctly. It plugs into the existing two-stage retrieval by **scope**:

- **Global** and **Term** rules are injected into **both** stages. Injecting them at stage-1 is the key fix for the original pain (the AI couldn't select the `user` table because it didn't know "creator = is_creator=1") — a term definition must be visible *before* table selection to steer it.
- **Table** rules ride along the existing catalog: they are injected into stage-2 only when their table is selected, so a table with dozens of code values costs tokens only when actually queried.
- After stage-1 picks the seed tables, a deterministic **graph-connect** step adds only the tables lying on shortest paths *between* already-selected tables (Steiner-style), pulling in junction tables so M:N paths connect. We rejected blanket k-hop neighbour expansion because a hub table (e.g. `user`) would drag in half the schema. When two selected tables are disconnected in the relationship graph, we pass them through anyway and annotate stage-2 that no known relationship exists, rather than erroring.

AI-bootstrapped rules and relationships are fed to the LLM even before human review (marked "unconfirmed"), so the layer is useful from day one; the un-reviewed state drives a UI highlight that prompts confirmation. Rejected withholding un-reviewed drafts: it would leave the layer empty until someone manually confirms everything, defeating the cold-start benefit.

The Semantic Layer is **global/shared** (like the Table Catalog), not per-user (unlike Trusted Queries), because it describes objective facts about the database. Any authenticated user may edit it in the MVP; a role gate can be added later if abuse appears.
