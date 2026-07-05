# Relationships modelled as uniform single-hop edges

The real analytics DB declares no foreign keys, so the Semantic Layer lets users author **Relationships** to teach the AI how tables join. We model every relationship as one uniform shape: a directed edge `from_table.from_col → to_table.to_col` plus a cardinality (`many-to-one` / `one-to-one`). The reverse direction (`has_many`) is derived, not authored, so the two sides can't drift apart.

Many-to-many is **not** a first-class type. An M:N link (e.g. `order` ↔ `product`) is represented as the two ordinary many-to-one edges on its junction table (`order_item → order`, `order_item → product`); the M:N relationship emerges when the system walks the relationship graph across multiple hops. This keeps one edge shape, one UI form, and gives junction-table questions for free — at the cost of requiring multi-hop graph traversal in retrieval (which we need anyway to fix stage-1 table selection).

Rejected: an explicit `through`-table M:N declaration. It duplicates information already in the junction table's two edges and forces a special case in both the UI and SQL generation.
