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
 */

export interface ConnectResult {
  /** Seed tables ∪ the intermediate tables needed to connect them (qualified). */
  tables: string[];
  /** Every relationship whose both endpoints are in `tables` — the JOIN hints. */
  edges: Relationship[];
  /** Unordered seed pairs with no connecting path within maxHops (qualified). */
  disconnectedPairs: [string, string][];
}

function endpoints(r: Relationship): [string, string] {
  return [qualifiedName(r.fromSchema, r.fromTable), qualifiedName(r.toSchema, r.toTable)];
}

/** BFS shortest path (as a node list) between two nodes, bounded by maxHops edges. */
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
      for (const neighbour of adjacency.get(node) ?? []) {
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
  const disconnectedPairs: [string, string][] = [];

  for (let i = 0; i < uniqueSeeds.length; i++) {
    for (let j = i + 1; j < uniqueSeeds.length; j++) {
      const path = shortestPath(adjacency, uniqueSeeds[i], uniqueSeeds[j], maxHops);
      if (path) {
        for (const node of path) tables.add(node);
      } else {
        disconnectedPairs.push([uniqueSeeds[i], uniqueSeeds[j]]);
      }
    }
  }

  const edges = relationships.filter((r) => {
    const [a, b] = endpoints(r);
    return tables.has(a) && tables.has(b);
  });

  return { tables: [...tables], edges, disconnectedPairs };
}
