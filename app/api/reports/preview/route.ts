import { NextResponse } from "next/server";
import { authorizeAction } from "@/lib/apiAuth";
import { isReadOnly, GuardrailError, isTimeoutError, REPORT_STATEMENT_TIMEOUT_MS } from "@/lib/guardrails";
import { normalizeParams, bindReportSql } from "@/lib/reports/params";
import { runGuardedQuery } from "@/lib/analytics/execute";

export const maxDuration = 60;

// POST /api/reports/preview — trial-run unsaved report SQL (Editor+) to discover
// the result columns for chart authoring. Runs with a tiny row cap since only the
// column metadata is needed. Not tied to a saved report.
export async function POST(request: Request) {
  if (!(await authorizeAction("report:create"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const querySql = typeof body.querySql === "string" ? body.querySql.trim() : "";
  if (!querySql) return NextResponse.json({ error: "SQL 不可為空" }, { status: 400 });
  if (!isReadOnly(querySql)) {
    return NextResponse.json({ error: "只允許單一 SELECT 查詢" }, { status: 400 });
  }
  const params = normalizeParams(body.params);
  if (typeof params === "string") return NextResponse.json({ error: params }, { status: 400 });

  const values = (body.values && typeof body.values === "object" ? body.values : {}) as Record<
    string,
    unknown
  >;
  const bound = bindReportSql(querySql, params, values);
  if (!bound.ok) return NextResponse.json({ error: bound.error }, { status: 400 });

  try {
    const { columns, rows } = await runGuardedQuery(bound.sql, {
      maxRows: 50, // only need column metadata + a small sample
      timeoutMs: REPORT_STATEMENT_TIMEOUT_MS,
      values: bound.values,
    });
    return NextResponse.json({ columns, rows });
  } catch (e) {
    if (e instanceof GuardrailError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (isTimeoutError(e)) {
      return NextResponse.json({ error: "查詢逾時，請縮小範圍後再試" }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
