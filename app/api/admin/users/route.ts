import { NextResponse } from "next/server";
import { authorizeAction } from "@/lib/apiAuth";
import { listUsers } from "@/lib/state/users";

// GET /api/admin/users — list all users with their roles (super_admin only).
// The middleware already gates /api/admin, but we re-check here so the route is
// safe on its own (defense in depth).
export async function GET() {
  if (!(await authorizeAction("user:manage"))) {
    return NextResponse.json({ error: "需要管理員權限" }, { status: 403 });
  }
  try {
    const users = await listUsers();
    return NextResponse.json({ users });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
