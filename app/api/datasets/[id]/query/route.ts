import { NextResponse } from "next/server";
import { currentUser } from "@/lib/apiAuth";
import { can } from "@/lib/auth/permissions";
import { getDatasetModel } from "@/lib/state/datasets";
import { parseExplorerQuery } from "@/lib/datasets/input";
import { compileExplorerQuery } from "@/lib/datasets/compile";
import { enforceTimeWindow } from "@/lib/datasets/timeWindow";
import { runGuardedQuery } from "@/lib/analytics/execute";
import { GuardrailError } from "@/lib/guardrails";

export const maxDuration = 60;

// POST /api/datasets/:id/query — compile an ExplorerQuery deterministically
// (zero LLM) and run it under the full guardrail belt. Returns rows + the
// generated SQL (the same transparency convention as the AI chat).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user || !can(user.role, "dataset:explore")) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const dataset = await getDatasetModel(id);
  if (!dataset) return NextResponse.json({ error: "查無此資料模型" }, { status: 404 });
  if (!dataset.published && !can(user.role, "dataset:manage")) {
    return NextResponse.json({ error: "此模型尚未發佈" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const query = parseExplorerQuery(body);
  if (typeof query === "string") {
    return NextResponse.json({ error: query }, { status: 400 });
  }

  // 時間治理：模型有時間維度時強制 ≤ 一年的時間窗（沒帶就注入預設近一年）。
  // 在伺服器端做，前端繞不過；注入的條件會反映在回傳 SQL 裡。
  const governed = enforceTimeWindow(dataset, query);
  if (typeof governed === "string") {
    return NextResponse.json({ error: governed }, { status: 400 });
  }

  try {
    const compiled = compileExplorerQuery(dataset, governed);
    const result = await runGuardedQuery(compiled.sql, { values: compiled.values });
    return NextResponse.json({
      columns: result.columns,
      rows: result.rows,
      sql: compiled.sql,
      fieldColumns: compiled.columns,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = e instanceof GuardrailError || msg.startsWith("模型不合法") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
