import { NextResponse } from "next/server";
import { authorizeAction } from "@/lib/apiAuth";
import { getReportById } from "@/lib/state/reports";
import { runGuardedQuery } from "@/lib/analytics/execute";
import { bindReportSql } from "@/lib/reports/params";
import { getNumberSetting } from "@/lib/settings/service";
import { GuardrailError, isTimeoutError, REPORT_STATEMENT_TIMEOUT_MS } from "@/lib/guardrails";

export const maxDuration = 60;

// POST /api/reports/:id/run — run a report and return its rows (report:run, i.e.
// any authenticated user). The body carries `values` for the report's declared
// Report Parameters, which are bound as prepared-statement values (never
// concatenated). The preview uses REPORT_MAX_ROWS; a larger export cap is slice 07.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("report:run"))) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const report = await getReportById(id);
  if (!report) return NextResponse.json({ error: "查無此報表" }, { status: 404 });

  let inputValues: Record<string, unknown> = {};
  try {
    const body = await request.json();
    if (body && typeof body === "object" && body.values && typeof body.values === "object") {
      inputValues = body.values as Record<string, unknown>;
    }
  } catch {
    /* no body → no parameter values (fine for a parameterless report) */
  }

  const bound = bindReportSql(report.querySql, report.params, inputValues);
  if (!bound.ok) {
    return NextResponse.json({ error: bound.error }, { status: 400 });
  }

  try {
    const { columns, rows } = await runGuardedQuery(bound.sql, {
      maxRows: await getNumberSetting("report.max_rows"), // runtime-editable (Super Admin)
      timeoutMs: REPORT_STATEMENT_TIMEOUT_MS,
      values: bound.values,
    });
    return NextResponse.json({ columns, rows, applied: bound.applied });
  } catch (e) {
    if (e instanceof GuardrailError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (isTimeoutError(e)) {
      return NextResponse.json(
        { error: "查詢逾時（可能掃描了過多資料），請縮小範圍或條件後再試" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
