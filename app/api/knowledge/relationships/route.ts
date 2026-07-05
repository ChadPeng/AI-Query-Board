import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { createRelationship, findReverseEdge } from "@/lib/state/relationships";
import { parseRelationshipBody } from "@/lib/knowledgeInput";

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = parseRelationshipBody(body);
  if (typeof parsed === "string") {
    return NextResponse.json({ error: parsed }, { status: 400 });
  }
  try {
    // Reverse-direction duplicate is a likely mistake (docs/adr/0001) — warn, don't block.
    const reverse = await findReverseEdge(parsed);
    const id = await createRelationship(parsed);
    return NextResponse.json({
      id,
      reverseWarning: reverse
        ? `已存在反向關係：${reverse.toSchema}.${reverse.toTable}.${reverse.toColumn} → ${reverse.fromSchema}.${reverse.fromTable}.${reverse.fromColumn}，兩者可能重複。`
        : null,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
