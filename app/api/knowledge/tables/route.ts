import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { updateCatalogEntry } from "@/lib/state/catalog";

/**
 * Edit a Table Catalog entry (description + review state). Keyed by its composite
 * (schema, table) primary key, passed in the body rather than the URL.
 */
export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const schema = typeof body.schema === "string" ? body.schema : "";
  const table = typeof body.table === "string" ? body.table : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  if (!schema || !table) {
    return NextResponse.json({ error: "缺少 schema / table" }, { status: 400 });
  }
  if (!description) {
    return NextResponse.json({ error: "描述不可為空" }, { status: 400 });
  }
  try {
    await updateCatalogEntry(schema, table, description, Boolean(body.reviewed), Boolean(body.excluded));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
