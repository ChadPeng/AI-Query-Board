import type { RowDataPacket } from "mysql2/promise";
import { statePool } from "../db";

/**
 * Failure telemetry for the AI query engine (JOIN 可靠性第二波，選配).
 * Every failure is a lead: a missing relationship, a bad description, or a
 * question worth adding to the eval set. Best-effort by design — recording
 * must NEVER break the user-facing error path.
 */

export interface QueryFailure {
  userId?: number;
  question: string;
  /** Which pipeline stage failed: retrieval / generate / readonly / guardrail /
   * execute / timeout / chart_repair. Self-repair ROUNDS (attempt-level errors
   * the loop then retried) are recorded too, prefixed `repair_` — stats split
   * them out so a recovered query never counts as a failure. */
  stage: string;
  sql?: string;
  errno?: number;
  errorMsg: string;
}

export async function recordQueryFailure(f: QueryFailure): Promise<void> {
  const pool = statePool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO query_failure (user_id, question, stage, sql_text, errno, error_msg)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        f.userId ?? null,
        f.question.slice(0, 2000),
        f.stage.slice(0, 32),
        f.sql?.slice(0, 8000) ?? null,
        f.errno ?? null,
        f.errorMsg.slice(0, 2000),
      ],
    );
  } catch {
    /* telemetry is never worth an error */
  }
}

export interface FailureStats {
  /** final failures (self-repair rounds excluded) */
  total: number;
  byStage: { stage: string; count: number }[];
  /** self-repair rounds triggered in the window (whether or not they recovered) */
  repairs: number;
}

/** Failure counts over the last `days` days, or null when unavailable. */
export async function getRecentFailureStats(days = 7): Promise<FailureStats | null> {
  const pool = statePool();
  if (!pool) return null;
  try {
    const [rows] = (await pool.query(
      `SELECT stage, COUNT(*) AS count
         FROM query_failure
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        GROUP BY stage
        ORDER BY count DESC`,
      [days],
    )) as [RowDataPacket[], unknown];
    const all = rows.map((r) => ({ stage: String(r.stage), count: Number(r.count) }));
    const byStage = all.filter((r) => !r.stage.startsWith("repair_"));
    const repairs = all
      .filter((r) => r.stage.startsWith("repair_"))
      .reduce((s, r) => s + r.count, 0);
    return { total: byStage.reduce((s, r) => s + r.count, 0), byStage, repairs };
  } catch {
    return null;
  }
}
