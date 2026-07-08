import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";
import type { ReportParam } from "../reports/params";
import type { OutputMode } from "../reports/chart";
import type { ChartSpec } from "../llm/types";

/** A Report as shown in the list (no SQL body — that's fetched on demand). */
export interface ReportSummary {
  id: number;
  title: string;
  authorId: number;
  createdAt: string;
  updatedAt: string;
}

/** A full Report, including its SQL body, parameters, chart spec + output mode. */
export interface Report extends ReportSummary {
  querySql: string;
  params: ReportParam[];
  chartSpec: ChartSpec | null;
  outputMode: OutputMode;
}

export interface ReportInput {
  title: string;
  querySql: string;
  params: ReportParam[];
  chartSpec: ChartSpec | null;
  outputMode: OutputMode;
}

/** mysql2 returns a JSON column as a parsed value (object) or a string, depending
 *  on driver/version — normalize to a params array either way. */
function parseParamsColumn(raw: unknown): ReportParam[] {
  if (raw == null) return [];
  const val = typeof raw === "string" ? safeJson(raw) : raw;
  return Array.isArray(val) ? (val as ReportParam[]) : [];
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Parse the chart_spec JSON column (parsed object or string) into a ChartSpec. */
function parseChartSpecColumn(raw: unknown): ChartSpec | null {
  if (raw == null) return null;
  const val = typeof raw === "string" ? safeJson(raw) : raw;
  return val && typeof val === "object" ? (val as ChartSpec) : null;
}

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

export async function listReports(): Promise<ReportSummary[]> {
  const [rows] = (await pool().query(
    `SELECT id, author_id, title, created_at, updated_at
       FROM report ORDER BY updated_at DESC, id DESC`,
  )) as [RowDataPacket[], unknown];
  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    authorId: Number(r.author_id),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }));
}

export async function getReportById(id: number): Promise<Report | null> {
  const [rows] = (await pool().query(
    `SELECT id, author_id, title, query_sql, params, chart_spec, output_mode, created_at, updated_at
       FROM report WHERE id = ? LIMIT 1`,
    [id],
  )) as [RowDataPacket[], unknown];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    title: String(r.title),
    authorId: Number(r.author_id),
    querySql: String(r.query_sql),
    params: parseParamsColumn(r.params),
    chartSpec: parseChartSpecColumn(r.chart_spec),
    outputMode: (r.output_mode as OutputMode) ?? "both",
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export async function createReport(authorId: number, input: ReportInput): Promise<number> {
  const [res] = (await pool().query(
    "INSERT INTO report (author_id, title, query_sql, params, chart_spec, output_mode) VALUES (?, ?, ?, ?, ?, ?)",
    [
      authorId,
      input.title,
      input.querySql,
      JSON.stringify(input.params),
      input.chartSpec ? JSON.stringify(input.chartSpec) : null,
      input.outputMode,
    ],
  )) as [ResultSetHeader, unknown];
  return res.insertId;
}

/** Update a Report's title + SQL + parameters + chart. Returns false if absent. */
export async function updateReport(id: number, input: ReportInput): Promise<boolean> {
  const [res] = (await pool().query(
    "UPDATE report SET title = ?, query_sql = ?, params = ?, chart_spec = ?, output_mode = ? WHERE id = ?",
    [
      input.title,
      input.querySql,
      JSON.stringify(input.params),
      input.chartSpec ? JSON.stringify(input.chartSpec) : null,
      input.outputMode,
      id,
    ],
  )) as [ResultSetHeader, unknown];
  return res.affectedRows > 0;
}

/** Hard-delete a Report (v1 has no versioning/audit). Returns false if absent. */
export async function deleteReport(id: number): Promise<boolean> {
  const [res] = (await pool().query("DELETE FROM report WHERE id = ?", [id])) as [
    ResultSetHeader,
    unknown,
  ];
  return res.affectedRows > 0;
}
