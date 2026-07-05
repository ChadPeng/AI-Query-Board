import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { runEngine } from "@/lib/engine";
import {
  createConversation,
  addTurn,
  getTurns,
} from "@/lib/state/conversations";

// text-to-SQL → chart can take a while when the LLM is retrying transient
// overload (two calls, each backing off up to ~30s).
export const maxDuration = 120;

/**
 * Slice 02/07: natural-language question -> {SQL, chart_spec} -> read-only query.
 * If conversationId is supplied, prior turns are fed as follow-up context, and
 * the new turn is persisted so the chat restores on reload.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "請先登入" }, { status: 401 });
  }
  const userId = Number(session.user.id);

  let question = "";
  let conversationId: number | null = null;
  try {
    const body = await request.json();
    question = typeof body?.question === "string" ? body.question : "";
    conversationId = Number.isInteger(body?.conversationId)
      ? Number(body.conversationId)
      : null;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!question.trim()) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }
  question = question.trim();

  // Load prior turns for follow-up context (scoped to this user).
  const priorTurns = conversationId ? await getTurns(conversationId, userId) : [];
  const history = priorTurns.map((t) => ({ question: t.question, sql: t.sql }));

  const result = await runEngine(question, { userId, history });

  // Persist the turn on success (best-effort — never fail the response on a
  // persistence hiccup). Creates a conversation on the first successful turn.
  if (result.ok) {
    try {
      if (!conversationId) conversationId = await createConversation(userId);
      await addTurn(conversationId, userId, {
        question,
        sql: result.sql,
        explanation: result.explanation,
      });
    } catch {
      /* non-fatal */
    }
  }

  return NextResponse.json({ ...result, conversationId });
}
