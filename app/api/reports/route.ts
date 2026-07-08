import { NextResponse } from "next/server";
import { authorizeAction, currentUser } from "@/lib/apiAuth";
import { listReports, createReport } from "@/lib/state/reports";
import { parseReportInput } from "@/lib/reports/validate";

// GET /api/reports — list all reports (any authenticated user: report:list).
export async function GET() {
  if (!(await authorizeAction("report:list"))) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  try {
    return NextResponse.json({ reports: await listReports() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// POST /api/reports — create a report (Editor+: report:create).
export async function POST(request: Request) {
  const me = await currentUser();
  if (!me || !(await authorizeAction("report:create"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
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
  try {
    const id = await createReport(me.id, parsed);
    return NextResponse.json({ id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
