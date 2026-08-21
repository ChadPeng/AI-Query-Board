import { NextResponse } from "next/server";
import { authorizeAction, currentUser } from "@/lib/apiAuth";
import { can } from "@/lib/auth/permissions";
import { getDatasetModel, updateDataset, deleteDataset } from "@/lib/state/datasets";
import { parseDatasetInput } from "@/lib/datasets/input";
import { probeDatasetInput } from "@/lib/datasets/probe";

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) ? id : null;
}

// GET /api/datasets/:id — the full model. Drafts are editor-only.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "請先登入" }, { status: 401 });
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const dataset = await getDatasetModel(id);
  if (!dataset) return NextResponse.json({ error: "查無此資料模型" }, { status: 404 });
  if (!dataset.published && !can(user.role, "dataset:manage")) {
    return NextResponse.json({ error: "此模型尚未發佈" }, { status: 403 });
  }
  return NextResponse.json({ dataset });
}

// PATCH /api/datasets/:id — replace-all update (Editor+), with live probes.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("dataset:manage"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (!(await getDatasetModel(id))) {
    return NextResponse.json({ error: "查無此資料模型" }, { status: 404 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = parseDatasetInput(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  const probeError = await probeDatasetInput(parsed);
  if (probeError) return NextResponse.json({ error: probeError }, { status: 400 });

  try {
    await updateDataset(id, parsed);
    return NextResponse.json({ ok: true, dataset: await getDatasetModel(id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Duplicate") ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? `模型名稱「${parsed.name}」已存在` : msg },
      { status },
    );
  }
}

// DELETE /api/datasets/:id — hard delete (Editor+).
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authorizeAction("dataset:manage"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  const id = parseId((await params).id);
  if (id == null) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  await deleteDataset(id);
  return NextResponse.json({ ok: true });
}
