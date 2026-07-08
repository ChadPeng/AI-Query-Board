import { NextResponse } from "next/server";
import { authorizeAction, currentUser } from "@/lib/apiAuth";
import { isRole } from "@/lib/auth/permissions";
import { setUserRole } from "@/lib/state/users";

// PATCH /api/admin/users/:id — assign a user's role (super_admin only).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await currentUser();
  if (!me || !(await authorizeAction("user:manage"))) {
    return NextResponse.json({ error: "需要管理員權限" }, { status: 403 });
  }
  const id = Number((await params).id);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!isRole(body.role)) {
    return NextResponse.json({ error: "無效的角色" }, { status: 400 });
  }
  // Guard against self-lockout: a super_admin can't demote themselves.
  if (id === me.id && body.role !== "super_admin") {
    return NextResponse.json({ error: "無法變更自己的角色" }, { status: 400 });
  }
  try {
    const ok = await setUserRole(id, body.role);
    if (!ok) return NextResponse.json({ error: "查無此使用者" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
