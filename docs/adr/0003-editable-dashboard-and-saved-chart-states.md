# Editable dashboard: saved-chart states and grid layout

Two dashboard UX gaps drove this: unpin was really delete, and charts couldn't be resized or rearranged.

**Saved-chart states.** A `pinned_charts` row is now a **Saved Chart** with two states — **On-board** (on the grid) and **Stashed** (kept in a collection tray, off the board). Pin/unpin toggles the state and never discards data; only an explicit delete removes the snapshot. Implemented with a state marker on the existing row (e.g. `position = NULL` ⇒ stashed, or an `on_board` flag) — no second table. Rejected making unpin delete (the original behaviour): users lose the snapshot and must re-ask to get it back.

**Editable layout via a grid library.** The dashboard becomes a draggable/resizable grid (react-grid-layout or equivalent), giving reorder + resize + snap + persistence in one dependency, and finally using the long-idle `position` column. Chart size persists as grid units (`w`/`h` columns on `pinned_charts`) alongside `position`. Rejected: hand-rolled free-pixel resize — it needs custom resize observers, persists awkwardly across screen sizes, and produces ragged layouts that fight the clean Apple card aesthetic. Cost accepted: one more dependency whose default styling must be overridden to match the design.
