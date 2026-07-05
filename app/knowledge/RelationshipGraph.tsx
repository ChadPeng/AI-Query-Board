"use client";

import type { Relationship } from "@/lib/state/relationships";

/**
 * Read-only relationship graph (docs/adr/0003): a deterministic circle layout of
 * all catalog tables with an edge per relationship. Its point is spotting
 * structure at a glance — especially islands (tables with no relationship), which
 * get a warning outline. Editing happens in the list, not here.
 */
export function RelationshipGraph({
  tables,
  relationships,
}: {
  tables: string[];
  relationships: Relationship[];
}) {
  if (tables.length === 0) return null;

  const W = 900;
  const H = 560;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(W, H) / 2 - 90;

  const pos = new Map<string, { x: number; y: number }>();
  tables.forEach((t, i) => {
    const angle = (2 * Math.PI * i) / tables.length - Math.PI / 2;
    pos.set(t, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  });

  const degree = new Map<string, number>();
  const bump = (t: string) => degree.set(t, (degree.get(t) ?? 0) + 1);
  const edges = relationships
    .map((rel) => {
      const from = `${rel.fromSchema}.${rel.fromTable}`;
      const to = `${rel.toSchema}.${rel.toTable}`;
      const a = pos.get(from);
      const b = pos.get(to);
      if (a && b) {
        bump(from);
        bump(to);
      }
      return a && b ? { a, b, key: rel.id } : null;
    })
    .filter((e): e is { a: { x: number; y: number }; b: { x: number; y: number }; key: number } => e != null);

  const islandCount = tables.filter((t) => !(degree.get(t) ?? 0)).length;

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="表關係圖">
        {edges.map((e) => (
          <line key={e.key} className="graph-edge" x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} />
        ))}
        {tables.map((t) => {
          const p = pos.get(t)!;
          const label = t.includes(".") ? t.split(".")[1] : t;
          const w = Math.max(48, label.length * 7 + 16);
          const isIsland = !(degree.get(t) ?? 0);
          return (
            <g key={t} className={`graph-node ${isIsland ? "island" : ""}`} transform={`translate(${p.x},${p.y})`}>
              <rect x={-w / 2} y={-11} width={w} height={22} rx={6} />
              <text textAnchor="middle" dominantBaseline="central">{label}</text>
            </g>
          );
        })}
      </svg>
      <div className="graph-legend">
        {tables.length} 張表、{edges.length} 條關係
        {islandCount > 0 ? ` · ${islandCount} 張孤島表（黃框，沒有任何關係）` : " · 無孤島表"}
      </div>
    </div>
  );
}
