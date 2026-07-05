import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listSavedCharts,
  addPinnedChart,
  updateChartLayout,
} from "@/lib/state/dashboard";
import { saveQuery } from "@/lib/state/savedQueries";
import type { ChartSpec } from "@/lib/llm/types";

async function requireUserId(): Promise<number | null> {
  const session = await auth();
  const id = session?.user?.id;
  return id ? Number(id) : null;
}

export async function GET() {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  try {
    const { board, stashed } = await listSavedCharts(userId);
    return NextResponse.json({ charts: board, stashed });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** Persist a drag/resize: body { layout: [{id,x,y,w,h}, ...] }. */
export async function PATCH(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  let body: { layout?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.layout)) {
    return NextResponse.json({ error: "缺少 layout" }, { status: 400 });
  }
  const items = body.layout
    .map((it) => it as Record<string, unknown>)
    .filter((it) => Number.isInteger(Number(it.id)))
    .map((it) => ({
      id: Number(it.id),
      x: Number(it.x) || 0,
      y: Number(it.y) || 0,
      w: Number(it.w) || 1,
      h: Number(it.h) || 1,
    }));
  try {
    await updateChartLayout(userId, items);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  let body: {
    title?: unknown;
    chartSpec?: ChartSpec;
    columns?: string[];
    rows?: Record<string, unknown>[];
    sql?: unknown;
    question?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.chartSpec || !Array.isArray(body.columns) || !Array.isArray(body.rows)) {
    return NextResponse.json({ error: "缺少圖表資料" }, { status: 400 });
  }

  try {
    const sql = String(body.sql ?? "");
    const chart = await addPinnedChart(userId, {
      title: String(body.title ?? body.chartSpec.title ?? "未命名圖表"),
      chartSpec: body.chartSpec,
      columns: body.columns,
      rows: body.rows,
      sql,
    });

    // Pinning = the user confirmed this query is correct → record it in the
    // trusted-query library (#3). Best-effort: a save failure must not fail the pin.
    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question && sql) {
      try {
        await saveQuery(userId, { question, sql, chartSpec: body.chartSpec });
      } catch {
        /* non-fatal */
      }
    }

    return NextResponse.json({ chart });
  } catch (e) {
    return NextResponse.json(
      { error: `釘選失敗：${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
