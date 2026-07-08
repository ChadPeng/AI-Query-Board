import { NextResponse } from "next/server";
import { authorizeAction } from "@/lib/apiAuth";
import { getReportById } from "@/lib/state/reports";
import { runGuardedQuery } from "@/lib/analytics/execute";
import { bindReportSql } from "@/lib/reports/params";
import { toCsv } from "@/lib/reports/csv";
import {
  GuardrailError,
  isTimeoutError,
  REPORT_EXPORT_MAX_ROWS,
  REPORT_STATEMENT_TIMEOUT_MS,
} from "@/lib/guardrails";

export const maxDuration = 120;

/** Build a Content-Disposition that carries a (possibly non-ASCII) filename. */
function contentDisposition(title: string): string {
  const base = (title || "report").replace(/[^\w一-鿿-]+/g, "_").slice(0, 80);
  const ascii = `${base.replace(/[^\x20-\x7e]+/g, "_") || "report"}.csv`;
  const utf8 = encodeURIComponent(`${base}.csv`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// POST /api/reports/:id/export — run a report on the export path (higher row cap)
// and stream the result as a CSV download (report:run). Body carries parameter
// `values`, bound as prepared-statement values just like the run endpoint.
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
    /* no body → parameterless export */
  }

  const bound = bindReportSql(report.querySql, report.params, inputValues);
  if (!bound.ok) return NextResponse.json({ error: bound.error }, { status: 400 });

  try {
    const { columns, rows } = await runGuardedQuery(bound.sql, {
      maxRows: REPORT_EXPORT_MAX_ROWS,
      timeoutMs: REPORT_STATEMENT_TIMEOUT_MS,
      values: bound.values,
    });
    return new Response(toCsv(columns, rows), {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": contentDisposition(report.title),
      },
    });
  } catch (e) {
    if (e instanceof GuardrailError) return NextResponse.json({ error: e.message }, { status: 400 });
    if (isTimeoutError(e)) {
      return NextResponse.json({ error: "匯出查詢逾時，請縮小範圍後再試" }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
