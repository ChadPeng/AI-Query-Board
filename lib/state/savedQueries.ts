import type { RowDataPacket } from "mysql2/promise";
import { statePool } from "../db";
import type { ChartSpec } from "../llm/types";

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

function parseJson<T>(v: unknown): T {
  return typeof v === "string" ? (JSON.parse(v) as T) : (v as T);
}

/** Normalize a question for exact-match lookup (and the unique key). */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[?？。.!！,，、]+$/g, "")
    .slice(0, 500);
}

export interface SavedQueryHit {
  id: number;
  sql: string;
  chartSpec: ChartSpec;
}

export interface NewSavedQuery {
  question: string;
  sql: string;
  chartSpec: ChartSpec;
}

/** Record a confirmed question→SQL pair (personal). Updates on re-confirm. */
export async function saveQuery(
  userId: number,
  q: NewSavedQuery,
): Promise<void> {
  await pool().query(
    `INSERT INTO saved_query (user_id, question, question_norm, query_sql, chart_spec)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       question = VALUES(question),
       query_sql = VALUES(query_sql),
       chart_spec = VALUES(chart_spec)`,
    [
      userId,
      q.question,
      normalizeQuestion(q.question),
      q.sql,
      JSON.stringify(q.chartSpec),
    ],
  );
}

/** Exact normalized-question hit, scoped to the user (or shared). */
export async function findExactSavedQuery(
  userId: number,
  questionNorm: string,
): Promise<SavedQueryHit | null> {
  try {
    const [rows] = (await pool().query(
      `SELECT id, query_sql, chart_spec
         FROM saved_query
        WHERE question_norm = ? AND (user_id = ? OR shared = 1)
        ORDER BY (user_id = ?) DESC
        LIMIT 1`,
      [questionNorm, userId, userId],
    )) as [RowDataPacket[], unknown];
    const r = rows[0];
    if (!r) return null;
    return { id: Number(r.id), sql: String(r.query_sql), chartSpec: parseJson(r.chart_spec) };
  } catch {
    return null;
  }
}

/** Candidate (id, question) pairs for the LLM paraphrase match. */
export async function listSavedQuestions(
  userId: number,
  limit = 50,
): Promise<{ id: number; question: string }[]> {
  try {
    const [rows] = (await pool().query(
      `SELECT id, question
         FROM saved_query
        WHERE user_id = ? OR shared = 1
        ORDER BY created_at DESC
        LIMIT ?`,
      [userId, limit],
    )) as [RowDataPacket[], unknown];
    return rows.map((r) => ({ id: Number(r.id), question: String(r.question) }));
  } catch {
    return [];
  }
}

export async function getSavedQueryById(
  id: number,
  userId: number,
): Promise<SavedQueryHit | null> {
  try {
    const [rows] = (await pool().query(
      `SELECT id, query_sql, chart_spec
         FROM saved_query
        WHERE id = ? AND (user_id = ? OR shared = 1)
        LIMIT 1`,
      [id, userId],
    )) as [RowDataPacket[], unknown];
    const r = rows[0];
    if (!r) return null;
    return { id: Number(r.id), sql: String(r.query_sql), chartSpec: parseJson(r.chart_spec) };
  } catch {
    return null;
  }
}
