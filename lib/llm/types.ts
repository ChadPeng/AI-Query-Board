/**
 * Shared types for the text-to-SQL engine. No server-only imports here so the
 * client (Chart component, page) can import the type definitions safely.
 */

export type ChartType = "bar" | "line" | "area" | "pie" | "table";
export type Aggregation = "sum" | "avg" | "count" | "min" | "max" | "none";

/**
 * The "narrow" chart spec the LLM is constrained to emit (PRD §3.2).
 * `x`/`y` must reference column names present in the SQL result set —
 * the engine validates this and repairs if they don't.
 */
export interface ChartSpec {
  chart_type: ChartType;
  x: string;
  y: string[];
  title: string;
  aggregation: Aggregation;
}

export interface EngineSuccess {
  ok: true;
  sql: string;
  explanation: string;
  chartSpec: ChartSpec;
  columns: string[];
  rows: Record<string, unknown>[];
  /** number of repair rounds the engine needed (0 = first try was valid) */
  repaired: number;
  /** tables stage-1 retrieval selected (empty when the sample-schema fallback was used) */
  tablesUsed?: string[];
  /** true when this result reused a confirmed query from the trusted-query library (#3) */
  fromSaved?: boolean;
}

export interface EngineFailure {
  ok: false;
  error: string;
  /** the last SQL the model produced, if it got that far */
  sql?: string;
}

export type EngineResult = EngineSuccess | EngineFailure;

/** The fields a chart spec references in the SQL result set. */
export function referencedFields(spec: ChartSpec): string[] {
  return [spec.x, ...spec.y];
}

/**
 * A Saved Chart (snapshot persisted in the state DB). It's On-board when shown on
 * the dashboard grid and Stashed when kept in the tray, off the board — pin/unpin
 * toggles `onBoard` and never deletes (docs/adr/0003). `layout` is its grid
 * position/size in layout units.
 */
export interface PinnedChart {
  id: number;
  title: string;
  chartSpec: ChartSpec;
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  onBoard: boolean;
  layout: { x: number; y: number; w: number; h: number };
}
