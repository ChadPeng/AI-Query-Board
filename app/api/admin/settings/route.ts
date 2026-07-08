import { NextResponse } from "next/server";
import { authorizeAction, currentUser } from "@/lib/apiAuth";
import { listSettings, setSetting } from "@/lib/settings/service";

// GET /api/admin/settings — list all settings resolved with their source
// (super_admin: setting:manage). Middleware also gates /api/admin.
export async function GET() {
  if (!(await authorizeAction("setting:manage"))) {
    return NextResponse.json({ error: "需要管理員權限" }, { status: 403 });
  }
  try {
    const settings = await listSettings();
    return NextResponse.json({ settings });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// PATCH /api/admin/settings — set (value: string) or clear (value: null) an
// override. Applies immediately (no restart).
export async function PATCH(request: Request) {
  const me = await currentUser();
  if (!me || !(await authorizeAction("setting:manage"))) {
    return NextResponse.json({ error: "需要管理員權限" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (typeof body.key !== "string") {
    return NextResponse.json({ error: "缺少設定 key" }, { status: 400 });
  }
  const value =
    body.value === null || body.value === undefined ? null : String(body.value);
  const err = await setSetting(body.key, value, me.id);
  if (err) return NextResponse.json({ error: err }, { status: 400 });
  return NextResponse.json({ ok: true });
}
