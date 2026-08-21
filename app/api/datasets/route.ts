import { NextResponse } from "next/server";
import { authorizeAction, currentUser } from "@/lib/apiAuth";
import { can } from "@/lib/auth/permissions";
import { listDatasets, createDataset, getDatasetModel } from "@/lib/state/datasets";
import { parseDatasetInput } from "@/lib/datasets/input";
import { probeDatasetInput } from "@/lib/datasets/probe";

// GET /api/datasets — editors see all (drafts included), viewers published only.
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "請先登入" }, { status: 401 });
  const publishedOnly = !can(user.role, "dataset:manage");
  const datasets = await listDatasets(publishedOnly);
  return NextResponse.json({ datasets, canManage: !publishedOnly });
}

// POST /api/datasets — create (Editor+), with live column/condition probes.
export async function POST(request: Request) {
  if (!(await authorizeAction("dataset:manage"))) {
    return NextResponse.json({ error: "需要 Editor 以上權限" }, { status: 403 });
  }
  const user = await currentUser();
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
    const id = await createDataset(user!.id, parsed);
    return NextResponse.json({ id, dataset: await getDatasetModel(id) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Duplicate") ? 400 : 500;
    return NextResponse.json(
      { error: status === 400 ? `模型名稱「${parsed.name}」已存在` : msg },
      { status },
    );
  }
}
