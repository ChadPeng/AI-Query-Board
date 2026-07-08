/**
 * Report chart authoring (Report output). A Report may carry a hand-authored
 * ChartSpec (no LLM) plus an output mode deciding what the runner sees. Pure — no
 * DB. Reuses the engine's narrow ChartSpec + referencedFields so a report chart
 * renders through the same deterministic ECharts path as AI charts.
 */
import type { ChartSpec, ChartType, Aggregation } from "../llm/types";
import { referencedFields } from "../llm/types";

export type OutputMode = "table" | "chart" | "both";
export const OUTPUT_MODES: OutputMode[] = ["table", "chart", "both"];

/** Chart types offered for a Report (a report's table view is a separate mode,
 *  so "table" is not a chart type here). */
export const REPORT_CHART_TYPES: ChartType[] = ["bar", "line", "area", "pie"];
const AGGREGATIONS: Aggregation[] = ["sum", "avg", "count", "min", "max", "none"];

export function isOutputMode(v: unknown): v is OutputMode {
  return typeof v === "string" && (OUTPUT_MODES as string[]).includes(v);
}

/**
 * Validate a chart spec. Structural checks always run; when `columns` is given
 * (e.g. from a trial run) it also enforces that every referenced field exists in
 * the result set — the same guarantee the AI engine's repair loop provides.
 * Returns an error message, or null when valid.
 */
export function validateChartSpec(spec: ChartSpec, columns?: string[]): string | null {
  if (!REPORT_CHART_TYPES.includes(spec.chart_type)) return "無效的圖表類型";
  if (!spec.x) return "請選擇 X 軸欄位";
  if (!spec.y || spec.y.length === 0) return "請至少選擇一個 Y 軸（數值）欄位";
  if (columns) {
    const missing = referencedFields(spec).filter((f) => !columns.includes(f));
    if (missing.length > 0) return `圖表引用了結果中不存在的欄位：${missing.join(", ")}`;
  }
  return null;
}

/**
 * Normalize a raw chart-spec payload from the editor into a clean ChartSpec, or
 * return an error string. Does not check columns (the editor does that against a
 * trial run); this is the structural gate.
 */
export function normalizeChartSpec(raw: unknown): ChartSpec | string {
  if (typeof raw !== "object" || raw === null) return "圖表設定格式錯誤";
  const o = raw as Record<string, unknown>;
  const chart_type = o.chart_type as ChartType;
  if (!REPORT_CHART_TYPES.includes(chart_type)) return "無效的圖表類型";
  const x = typeof o.x === "string" ? o.x.trim() : "";
  const y = Array.isArray(o.y) ? o.y.map((v) => String(v).trim()).filter(Boolean) : [];
  const title = typeof o.title === "string" ? o.title.trim() : "";
  const aggregation = AGGREGATIONS.includes(o.aggregation as Aggregation)
    ? (o.aggregation as Aggregation)
    : "none";
  const spec: ChartSpec = { chart_type, x, y, title, aggregation };
  const err = validateChartSpec(spec);
  if (err) return err;
  return spec;
}
