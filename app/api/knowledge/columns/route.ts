import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { ensureAnalyticsPool } from "@/lib/db";
import { listColumnsInSchemas, parseQualified, qualifiedName } from "@/lib/schema/introspect";

// GET /api/knowledge/columns?tables=mepay.orders,mepay.users
// Column metadata for the model builder (pick dimension/measure columns, join
// columns) and the Explorer's filter widgets.
export async function GET(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const raw = new URL(request.url).searchParams.get("tables") ?? "";
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.length === 0 || wanted.length > 20) {
    return NextResponse.json({ error: "tables 參數需為 1–20 個 schema.table" }, { status: 400 });
  }
  if (!(await ensureAnalyticsPool())) {
    return NextResponse.json({ error: "分析資料庫未設定" }, { status: 503 });
  }
  const schemas = [
    ...new Set(wanted.map((t) => parseQualified(t)?.schema).filter((s): s is string => !!s)),
  ];
  try {
    const all = await listColumnsInSchemas(schemas);
    const wantedSet = new Set(wanted);
    const columns: Record<string, { column: string; dataType: string; columnKey: string }[]> = {};
    for (const c of all) {
      const t = qualifiedName(c.schema, c.table);
      if (!wantedSet.has(t)) continue;
      (columns[t] ??= []).push({ column: c.column, dataType: c.dataType, columnKey: c.columnKey });
    }
    return NextResponse.json({ columns });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
