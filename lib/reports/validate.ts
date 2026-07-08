import { isReadOnly } from "../guardrails";
import type { ReportInput } from "../state/reports";
import { normalizeParams } from "./params";
import { isOutputMode, normalizeChartSpec } from "./chart";

/**
 * Validate a Report create/edit payload. Pure — returns a normalized ReportInput,
 * or an error string (mirrors parseRuleBody's convention). Rejects non-read-only
 * SQL at author time so a broken Report can't be saved; the runner re-checks as a
 * belt. Shared by the create (POST) and edit (PATCH) routes.
 */
export function parseReportInput(body: Record<string, unknown>): ReportInput | string {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const querySql = typeof body.querySql === "string" ? body.querySql.trim() : "";
  if (!title) return "報表名稱不可為空";
  if (title.length > 255) return "報表名稱過長（上限 255 字）";
  if (!querySql) return "SQL 不可為空";
  if (!isReadOnly(querySql)) return "只允許單一 SELECT 查詢（不可有多段語句或寫入）";
  const params = normalizeParams(body.params);
  if (typeof params === "string") return params;

  const outputMode = isOutputMode(body.outputMode) ? body.outputMode : "both";

  let chartSpec = null;
  if (body.chartSpec != null) {
    const spec = normalizeChartSpec(body.chartSpec);
    if (typeof spec === "string") return spec;
    chartSpec = spec;
  }
  // A chart-only report must actually have a chart; "both" with no chart falls
  // back to a table view at run time (CONTEXT.md: "沒配圖退純表格").
  if (outputMode === "chart" && !chartSpec) return "圖表模式需要設定一個圖表";

  return { title, querySql, params, chartSpec, outputMode };
}
