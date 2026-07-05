import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removePinnedChart, setChartOnBoard } from "@/lib/state/dashboard";

async function requireUserId(): Promise<number | null> {
  const session = await auth();
  return session?.user?.id ? Number(session.user.id) : null;
}

/** Toggle board membership: body { onBoard: boolean }. Unpin keeps the snapshot. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await requireUserId();
  if (!userId) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  const chartId = Number((await params).id);
  if (!Number.isInteger(chartId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: { onBoard?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.onBoard !== "boolean") {
    return NextResponse.json({ error: "缺少 onBoard" }, { status: 400 });
  }
  try {
    const ok = await setChartOnBoard(userId, chartId, body.onBoard);
    if (!ok) return NextResponse.json({ error: "找不到該圖表" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  const userId = session?.user?.id ? Number(session.user.id) : null;
  if (!userId) return NextResponse.json({ error: "請先登入" }, { status: 401 });

  const { id } = await params;
  const chartId = Number(id);
  if (!Number.isInteger(chartId)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const removed = await removePinnedChart(userId, chartId);
    if (!removed) return NextResponse.json({ error: "找不到該圖表" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
