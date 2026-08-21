import type { Relationship } from "../state/relationships";
import { qualifiedName } from "./introspect";

/**
 * Deterministic graph-connect over the Relationship edges (see docs/adr/0002).
 *
 * Stage-1 picks seed tables from the catalog; this step adds only the tables
 * lying on shortest paths BETWEEN those seeds (Steiner-style), so junction
 * tables get pulled in and M:N paths connect — without the blanket k-hop
 * neighbour expansion that a hub table like `user` would explode.
 *
 * Seeds that have no path to any other seed within maxHops are reported as
 * disconnected; the caller passes them through anyway and annotates stage-2.
 *
 * Besides the node set, the walked paths are kept as ordered JOIN steps
 * (which columns connect each hop) so stage-2 can render ready-to-copy JOIN
 * chains — the model no longer re-derives multi-hop joins from loose edges.
 */

export interface JoinPathStep {
  /** schema-qualified tables */
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  reviewed: boolean;
}

export interface JoinPath {
  /** the two seed tables this path connects (qualified) */
  seedPair: [string, string];
  steps: JoinPathStep[];
}

export interface ConnectResult {
  /** Seed tables ∪ the intermediate tables needed to connect them (qualified). */
  tables: string[];
  /** Every relationship whose both endpoints are in `tables` — the JOIN hints. */
  edges: Relationship[];
  /** Shortest paths between connected seed pairs, as ordered JOIN steps. */
  paths: JoinPath[];
  /** Unordered seed pairs with no connecting path within maxHops (qualified). */
  disconnectedPairs: [string, string][];
}

function endpoints(r: Relationship): [string, string] {
  return [qualifiedName(r.fromSchema, r.fromTable), qualifiedName(r.toSchema, r.toTable)];
}

/**
 * BFS shortest path (as a node list) between two nodes, bounded by maxHops
 * edges. Neighbours are visited in sorted order so, among equal-length paths,
 * the same one wins every run (idempotent prompts).
 */
function shortestPath(
  adjacency: Map<string, Set<string>>,
  start: string,
  goal: string,
  maxHops: number,
): string[] | null {
  if (start === goal) return [start];
  const visited = new Set<string>([start]);
  let frontier: string[][] = [[start]];
  for (let hop = 0; hop < maxHops && frontier.length > 0; hop++) {
    const next: string[][] = [];
    for (const path of frontier) {
      const node = path[path.length - 1];
      for (const neighbour of [...(adjacency.get(node) ?? [])].sort()) {
        if (neighbour === goal) return [...path, neighbour];
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          next.push([...path, neighbour]);
        }
      }
    }
    frontier = next;
  }
  return null;
}

/**
 * The step joining two adjacent path nodes, oriented a→b. When several edges
 * connect the same pair, prefer reviewed ones, then lexicographic — the pick
 * must be stable across runs. (The other edges still reach the model via
 * `edges`.)
 */
function stepBetween(relationships: Relationship[], a: string, b: string): JoinPathStep | null {
  const candidates = relationships
    .filter((r) => {
      const [x, y] = endpoints(r);
      return (x === a && y === b) || (x === b && y === a);
    })
    .sort(
      (r1, r2) =>
        Number(r2.reviewed) - Number(r1.reviewed) ||
        r1.fromColumn.localeCompare(r2.fromColumn) ||
        r1.toColumn.localeCompare(r2.toColumn),
    );
  const edge = candidates[0];
  if (!edge) return null;
  const [x] = endpoints(edge);
  return x === a
    ? { fromTable: a, fromColumn: edge.fromColumn, toTable: b, toColumn: edge.toColumn, reviewed: edge.reviewed }
    : { fromTable: a, fromColumn: edge.toColumn, toTable: b, toColumn: edge.fromColumn, reviewed: edge.reviewed };
}

const MAX_PATHS = 5;

/** Drop exact/contained duplicates (shared prefixes are common) and cap. */
function dedupePaths(paths: JoinPath[]): JoinPath[] {
  const key = (p: JoinPath) =>
    "|" +
    p.steps
      .map((s) => `${s.fromTable}.${s.fromColumn}>${s.toTable}.${s.toColumn}`)
      .join("|") +
    "|";
  const sorted = [...paths].sort(
    (p1, p2) => p2.steps.length - p1.steps.length || key(p1).localeCompare(key(p2)),
  );
  const kept: JoinPath[] = [];
  for (const p of sorted) {
    if (kept.length >= MAX_PATHS) break;
    const k = key(p);
    if (!kept.some((q) => key(q).includes(k))) kept.push(p);
  }
  return kept;
}

export function connectTables(
  seeds: string[],
  relationships: Relationship[],
  maxHops = 3,
): ConnectResult {
  const uniqueSeeds = [...new Set(seeds)];

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
  };
  for (const r of relationships) {
    const [a, b] = endpoints(r);
    link(a, b);
    link(b, a);
  }

  const tables = new Set<string>(uniqueSeeds);
  const paths: JoinPath[] = [];
  const disconnectedPairs: [string, string][] = [];

  for (let i = 0; i < uniqueSeeds.length; i++) {
    for (let j = i + 1; j < uniqueSeeds.length; j++) {
      const path = shortestPath(adjacency, uniqueSeeds[i], uniqueSeeds[j], maxHops);
      if (path) {
        for (const node of path) tables.add(node);
        const steps: JoinPathStep[] = [];
        for (let k = 0; k + 1 < path.length; k++) {
          const step = stepBetween(relationships, path[k], path[k + 1]);
          if (step) steps.push(step);
        }
        // Only keep complete chains — a hole would render a misleading hint.
        if (steps.length === path.length - 1 && steps.length > 0) {
          paths.push({ seedPair: [uniqueSeeds[i], uniqueSeeds[j]], steps });
        }
      } else {
        disconnectedPairs.push([uniqueSeeds[i], uniqueSeeds[j]]);
      }
    }
  }

  const edges = relationships.filter((r) => {
    const [a, b] = endpoints(r);
    return tables.has(a) && tables.has(b);
  });

  return { tables: [...tables], edges, paths: dedupePaths(paths), disconnectedPairs };
}
