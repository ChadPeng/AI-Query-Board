import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

export interface ConversationTurn {
  question: string;
  sql: string;
  explanation: string | null;
}

export async function createConversation(userId: number): Promise<number> {
  const [res] = (await pool().query(
    "INSERT INTO conversation (user_id) VALUES (?)",
    [userId],
  )) as [ResultSetHeader, unknown];
  return res.insertId;
}

export async function addTurn(
  conversationId: number,
  userId: number,
  turn: { question: string; sql: string; explanation: string | null },
): Promise<void> {
  await pool().query(
    `INSERT INTO conversation_turn (conversation_id, user_id, question, query_sql, explanation)
     VALUES (?, ?, ?, ?, ?)`,
    [conversationId, userId, turn.question, turn.sql, turn.explanation],
  );
}

/** Most recent conversation id for a user, or null. [] on missing table. */
export async function getLatestConversationId(
  userId: number,
): Promise<number | null> {
  try {
    const [rows] = (await pool().query(
      "SELECT id FROM conversation WHERE user_id = ? ORDER BY id DESC LIMIT 1",
      [userId],
    )) as [RowDataPacket[], unknown];
    return rows[0] ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

/** Ordered turns of a conversation, scoped to its owner. */
export async function getTurns(
  conversationId: number,
  userId: number,
): Promise<ConversationTurn[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT question, query_sql, explanation
         FROM conversation_turn
        WHERE conversation_id = ? AND user_id = ?
        ORDER BY id`,
      [conversationId, userId],
    )) as [RowDataPacket[], unknown];
    return rows.map((r) => ({
      question: String(r.question),
      sql: String(r.query_sql),
      explanation: r.explanation == null ? null : String(r.explanation),
    }));
  } catch {
    return [];
  }
}
