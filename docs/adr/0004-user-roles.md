# Introduce user roles (Super Admin / Editor / Viewer)

Adding the Report feature (engineers publish queries for the operations team to run) forces a producer/consumer split, so we are introducing roles — reversing this project's deliberate "no roles, any authenticated user can do anything" stance. There are three tiers, each user holds exactly one, and a higher tier includes everything the lower tiers can do:

- **Super Admin** — the only role that manages users + role assignment and edits system Settings (see ADR-0005).
- **Editor** ("RD") — authors and edits Reports, writes raw SQL, declares parameters and chart specs.
- **Viewer** ("operations") — runs Reports, fills parameters, views and exports; cannot author.

Implemented as a single `role` enum column on `users`; the seed account `admin@gmail.com` becomes the first Super Admin.

## Why (the non-obvious part)

Raw-SQL authoring is **not** a data-access escalation: an Editor's hand-written SQL runs through the exact same guardrails as AI-generated SQL (read-only DB account, sensitive-column blacklist, prepared-statement parameter binding, forced row cap, statement timeout). Any authenticated user could already reach the same data by asking the AI. So roles here exist for **governance** — deciding who may author/edit a published query vs. who may only run it — not for preventing data leakage. This is why the split is Editor/Viewer around *authoring*, not around *what data is reachable*.

## Considered alternatives

- **No roles (keep the status quo).** Rejected: the entire point of the feature is "RD provides SQL for ops to use" — without a producer/consumer boundary that split isn't modelled at all, and Viewers could silently edit published SQL.
- **Per-report ownership instead of global roles.** Rejected for v1 as insufficient (doesn't gate the raw-SQL authoring surface at all); can be layered on later to control *which* Editor may edit *which* report.

## Consequences

- `authorized()` must gain role-aware gating (today it only checks "is logged in").
- The Semantic Layer / Table Catalog are currently editable by any authenticated user (ADR-0002). With roles in place, that editing surface should most naturally move to **Editor and above** — to be confirmed when the roles land.
