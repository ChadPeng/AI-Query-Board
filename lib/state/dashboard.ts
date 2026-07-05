import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";
import type { ChartSpec, PinnedChart } from "../llm/types";

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

/** mysql2 auto-parses JSON columns to objects, but tolerate string too. */
function parseJson<T>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}

export interface NewPinnedChart {
  title: string;
  chartSpec: ChartSpec;
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
}

function rowToChart(r: RowDataPacket): PinnedChart {
  return {
    id: Number(r.id),
    title: String(r.title),
    chartSpec: parseJson<ChartSpec>(r.chart_spec),
    columns: parseJson<string[]>(r.result_columns),
    rows: parseJson<Record<string, unknown>[]>(r.result_rows),
    sql: String(r.query_sql),
    onBoard: Boolean(r.on_board),
    layout: { x: Number(r.x), y: Number(r.y), w: Number(r.w), h: Number(r.h) },
  };
}

const COLS =
  "id, title, chart_spec, result_columns, result_rows, query_sql, on_board, x, y, w, h";

/** A user's Saved Charts, split by board membership. [] if the table is absent. */
export async function listSavedCharts(
  userId: number,
): Promise<{ board: PinnedChart[]; stashed: PinnedChart[] }> {
  try {
    const [rows] = (await pool().query(
      `SELECT ${COLS} FROM pinned_charts WHERE user_id = ? ORDER BY y, x, position, id`,
      [userId],
    )) as [RowDataPacket[], unknown];
    const all = rows.map(rowToChart);
    return {
      board: all.filter((c) => c.onBoard),
      stashed: all.filter((c) => !c.onBoard),
    };
  } catch {
    return { board: [], stashed: [] };
  }
}

export async function addPinnedChart(
  userId: number,
  c: NewPinnedChart,
): Promise<PinnedChart> {
  // Append below existing on-board charts and at the end of the legacy order.
  const [aggRows] = (await pool().query(
    `SELECT COALESCE(MAX(position), -1) + 1 AS pos,
            COALESCE(MAX(y + h), 0) AS nexty
       FROM pinned_charts WHERE user_id = ?`,
    [userId],
  )) as [RowDataPacket[], unknown];
  const position = Number(aggRows[0]?.pos ?? 0);
  const y = Number(aggRows[0]?.nexty ?? 0);
  const w = 6;
  const h = 8;

  const [res] = (await pool().query(
    `INSERT INTO pinned_charts
       (user_id, title, chart_spec, result_columns, result_rows, query_sql, position, on_board, x, y, w, h)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)`,
    [
      userId,
      c.title,
      JSON.stringify(c.chartSpec),
      JSON.stringify(c.columns),
      JSON.stringify(c.rows),
      c.sql,
      position,
      y,
      w,
      h,
    ],
  )) as [ResultSetHeader, unknown];

  return {
    id: res.insertId,
    title: c.title,
    chartSpec: c.chartSpec,
    columns: c.columns,
    rows: c.rows,
    sql: c.sql,
    onBoard: true,
    layout: { x: 0, y, w, h },
  };
}

/** Pin (onBoard=true) or unpin (false) a chart — never deletes. Scoped to owner. */
export async function setChartOnBoard(
  userId: number,
  id: number,
  onBoard: boolean,
): Promise<boolean> {
  const [res] = (await pool().query(
    "UPDATE pinned_charts SET on_board = ? WHERE id = ? AND user_id = ?",
    [onBoard ? 1 : 0, id, userId],
  )) as [ResultSetHeader, unknown];
  return res.affectedRows > 0;
}

/** Persist a drag/resize: batch-update grid layout for the user's charts. */
export async function updateChartLayout(
  userId: number,
  items: { id: number; x: number; y: number; w: number; h: number }[],
): Promise<void> {
  if (items.length === 0) return;
  const conn = await pool().getConnection();
  try {
    await conn.beginTransaction();
    for (const it of items) {
      await conn.query(
        "UPDATE pinned_charts SET x = ?, y = ?, w = ?, h = ? WHERE id = ? AND user_id = ?",
        [it.x, it.y, it.w, it.h, it.id, userId],
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Delete a Saved Chart permanently, scoped to its owner. */
export async function removePinnedChart(
  userId: number,
  id: number,
): Promise<boolean> {
  const [res] = (await pool().query(
    "DELETE FROM pinned_charts WHERE id = ? AND user_id = ?",
    [id, userId],
  )) as [ResultSetHeader, unknown];
  return res.affectedRows > 0;
}
