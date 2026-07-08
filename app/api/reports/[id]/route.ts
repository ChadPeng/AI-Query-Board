import { NextResponse } from "next/server";
import { authorizeAction } from "@/lib/apiAuth";
import { getReportById, updateReport, deleteReport } from "@/lib/state/reports";
import { parseReportInput } from "@/lib/reports/validate";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// GET /api/reports/:id — fetch one report incl. its SQL (report:list).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("report:list"))) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const report = await getReportById(id);
  if (!report) return NextResponse.json({ error: "查無此報表" }, { status: 404 });
  return NextResponse.json({ report });
}

// PATCH /api/reports/:id — edit title + SQL (Editor+: report:edit).
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("report:edit"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = parseReportInput(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  const ok = await updateReport(id, parsed);
  if (!ok) return NextResponse.json({ error: "查無此報表" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/reports/:id — hard-delete (Editor+: report:delete).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("report:delete"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const ok = await deleteReport(id);
  if (!ok) return NextResponse.json({ error: "查無此報表" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
