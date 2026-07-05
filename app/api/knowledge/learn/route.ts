import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { learnFromSql } from "@/lib/learnFromSql";

/** Learn Semantic Layer drafts from pasted SQL (slice 15). Body: { sql }. */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  let body: { sql?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const sql = typeof body.sql === "string" ? body.sql : "";
  if (!sql.trim()) {
    return NextResponse.json({ error: "請貼上至少一段 SQL" }, { status: 400 });
  }
  try {
    const summary = await learnFromSql(sql);
    return NextResponse.json(summary);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
