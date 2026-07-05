import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLatestConversationId, getTurns } from "@/lib/state/conversations";

/** Restore the user's most recent conversation (chat log) on page load. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const userId = Number(session.user.id);

  const id = await getLatestConversationId(userId);
  if (!id) return NextResponse.json({ conversation: null });

  const turns = await getTurns(id, userId);
  return NextResponse.json({ conversation: { id, turns } });
}
