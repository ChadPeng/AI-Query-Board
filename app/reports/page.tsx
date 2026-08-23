"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { can, isRole } from "@/lib/auth/permissions";
import type { ParamType, ReportParam } from "@/lib/reports/params";
import { REPORT_CHART_TYPES, OUTPUT_MODES, validateChartSpec, type OutputMode } from "@/lib/reports/chart";
import type { ChartSpec, ChartType } from "@/lib/llm/types";
import { Chart, formatCell, type ChartHandle } from "../components/Chart";
import { AppShell } from "../components/Sidebar";

interface ReportSummary {
  id: number;
  title: string;
  authorId: number;
  updatedAt: string;
}

interface FullReport extends ReportSummary {
  querySql: string;
  params: ReportParam[];
  chartSpec: ChartSpec | null;
  outputMode: OutputMode;
}

interface RunResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

type Editing = {
  id: number | null;
  title: string;
  querySql: string;
  params: ReportParam[];
  chartSpec: ChartSpec | null;
  outputMode: OutputMode;
  trialColumns: string[];
} | null;

type RunTarget = { id: number; title: string; params: ReportParam[]; chartSpec: ChartSpec | null; outputMode: OutputMode } | null;

const TYPE_LABEL: Record<ParamType, string> = {
  date: "日期",
  date_range: "日期區間",
  number: "數字",
  text: "文字",
  enum: "下拉選單",
};
const MODE_LABEL: Record<OutputMode, string> = { table: "只有表格", chart: "只有圖", both: "表格＋圖" };
const CHART_LABEL: Partial<Record<ChartType, string>> = {
  bar: "長條圖",
  line: "折線圖",
  area: "面積圖",
  pie: "圓餅圖",
};


function initRunValues(params: ReportParam[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    out[p.name] = p.type === "date_range" ? { start: "", end: "" } : (p.default ?? "");
  }
  return out;
}

/** Harmless per-type values so a trial run can discover columns even when required
 *  params are unfilled (columns don't depend on the values). */
function trialValues(params: ReportParam[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of params) {
    if (p.type === "date_range") out[p.name] = { start: "2000-01-01", end: "2000-12-31" };
    else if (p.type === "date") out[p.name] = p.default || "2000-01-01";
    else if (p.type === "number") out[p.name] = p.default || "0";
    else if (p.type === "enum") out[p.name] = p.default || p.options?.[0] || "";
    else out[p.name] = p.default || "x";
  }
  return out;
}

const emptySpec = (): ChartSpec => ({ chart_type: "bar", x: "", y: [], title: "", aggregation: "none" });

export default function ReportsPage() {
  const { data: session } = useSession();
  const role = isRole(session?.user?.role) ? session.user.role : "viewer";
  const canAuthor = can(role, "report:create");

  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState(false);
  const [trialing, setTrialing] = useState(false);

  const [runTarget, setRunTarget] = useState<RunTarget>(null);
  const [runValues, setRunValues] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<RunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const chartRef = useRef<ChartHandle>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "載入失敗");
        return;
      }
      const d = await res.json();
      setReports(d.reports ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function fetchReport(id: number): Promise<FullReport | null> {
    const res = await fetch(`/api/reports/${id}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(d.error ?? "載入失敗");
      return null;
    }
    return d.report as FullReport;
  }

  const doRun = useCallback(async (id: number, values: Record<string, unknown>) => {
    setRunning(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${id}/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "執行失敗");
        return;
      }
      setResult({ columns: d.columns ?? [], rows: d.rows ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, []);

  async function openRun(r: { id: number }) {
    setEditing(null);
    setResult(null);
    setError(null);
    const full = await fetchReport(r.id);
    if (!full) return;
    setRunTarget({ id: full.id, title: full.title, params: full.params, chartSpec: full.chartSpec, outputMode: full.outputMode });
    const initial = initRunValues(full.params);
    setRunValues(initial);
    if (full.params.length === 0) await doRun(full.id, initial);
  }

  async function startEdit(r: { id: number }) {
    setRunTarget(null);
    setResult(null);
    setError(null);
    const full = await fetchReport(r.id);
    if (!full) return;
    setEditing({
      id: full.id,
      title: full.title,
      querySql: full.querySql,
      params: full.params,
      chartSpec: full.chartSpec,
      outputMode: full.outputMode,
      trialColumns: [],
    });
  }

  function startCreate() {
    setRunTarget(null);
    setResult(null);
    setError(null);
    setEditing({ id: null, title: "", querySql: "", params: [], chartSpec: null, outputMode: "both", trialColumns: [] });
  }

  async function trialRun() {
    if (!editing) return;
    setTrialing(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          querySql: editing.querySql,
          params: editing.params,
          values: trialValues(editing.params),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "試跑失敗");
        return;
      }
      const columns: string[] = d.columns ?? [];
      // Seed a chart spec if none yet, defaulting x/y to the first columns.
      const spec = editing.chartSpec ?? emptySpec();
      setEditing({
        ...editing,
        trialColumns: columns,
        chartSpec: {
          ...spec,
          x: spec.x || columns[0] || "",
          y: spec.y.length ? spec.y : columns.slice(1, 2),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTrialing(false);
    }
  }

  async function save() {
    if (!editing) return;
    // Guard chart mapping client-side before saving (server re-checks structurally).
    if (editing.outputMode !== "table") {
      if (!editing.chartSpec) {
        setError("請先試跑並設定圖表，或把輸出模式改為「只有表格」");
        return;
      }
      const err = validateChartSpec(
        editing.chartSpec,
        editing.trialColumns.length ? editing.trialColumns : undefined,
      );
      if (err) {
        setError(err);
        return;
      }
    }
    setSaving(true);
    setError(null);
    const isNew = editing.id == null;
    // A table-only report doesn't persist a chart spec.
    const chartSpec = editing.outputMode === "table" ? null : editing.chartSpec;
    try {
      const res = await fetch(isNew ? "/api/reports" : `/api/reports/${editing.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editing.title,
          querySql: editing.querySql,
          params: editing.params,
          chartSpec,
          outputMode: editing.outputMode,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error ?? "儲存失敗");
        return;
      }
      setEditing(null);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: { id: number; title: string }) {
    if (!confirm(`確定刪除報表「${r.title}」？此操作無法復原。`)) return;
    setError(null);
    const res = await fetch(`/api/reports/${r.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(d.error ?? "刪除失敗");
      return;
    }
    if (runTarget?.id === r.id) {
      setRunTarget(null);
      setResult(null);
    }
    await loadList();
  }

  // ---- param-declaration editor helpers ----
  function updateParam(idx: number, patch: Partial<ReportParam>) {
    if (!editing) return;
    setEditing({ ...editing, params: editing.params.map((p, i) => (i === idx ? { ...p, ...patch } : p)) });
  }
  function addParam() {
    if (!editing) return;
    setEditing({ ...editing, params: [...editing.params, { name: "", type: "date", label: "", required: true }] });
  }
  function removeParam(idx: number) {
    if (!editing) return;
    setEditing({ ...editing, params: editing.params.filter((_, i) => i !== idx) });
  }

  // ---- chart-spec editor helpers ----
  function updateSpec(patch: Partial<ChartSpec>) {
    if (!editing) return;
    setEditing({ ...editing, chartSpec: { ...(editing.chartSpec ?? emptySpec()), ...patch } });
  }
  function toggleY(col: string) {
    if (!editing) return;
    const spec = editing.chartSpec ?? emptySpec();
    const y = spec.y.includes(col) ? spec.y.filter((c) => c !== col) : [...spec.y, col];
    updateSpec({ y });
  }

  const showChart = (m: OutputMode, spec: ChartSpec | null) => spec != null && (m === "chart" || m === "both");
  const showTable = (m: OutputMode, spec: ChartSpec | null) => m === "table" || m === "both" || spec == null;

  function triggerDownload(href: string, filename: string, revoke = false) {
    const a = document.createElement("a");
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (revoke) URL.revokeObjectURL(href);
  }

  async function downloadCsv() {
    if (!runTarget) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${runTarget.id}/export`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: runValues }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "匯出失敗");
        return;
      }
      const blob = await res.blob();
      triggerDownload(URL.createObjectURL(blob), `${runTarget.title || "report"}.csv`, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  function downloadPng() {
    const url = chartRef.current?.toPng();
    if (!url) return;
    triggerDownload(url, `${runTarget?.title || "chart"}.png`);
  }

  const filtered = (reports ?? []).filter((r) =>
    r.title.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  const selectedId = editing?.id ?? runTarget?.id ?? null;

  return (
    <AppShell
      active="reports"
      title="報表"
      subtitle="具名、可重用的查詢報表——挑一張、填參數、執行、匯出"
      bleed
      actions={
        canAuthor ? (
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            新增報表
          </button>
        ) : undefined
      }
    >
      <div className="master-detail">
        {/* 左：報表清單 */}
        <aside className="list-pane">
          <div className="list-search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5" stroke="var(--text-dim)" strokeWidth="1.5" />
              <path d="M11 11L14 14" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="搜尋報表…"
            />
          </div>
          <div className="list-body">
            {!reports && !error && <div className="kn-empty">載入中…</div>}
            {reports && reports.length === 0 && (
              <div className="kn-empty">
                還沒有報表。{canAuthor ? "點右上角「新增報表」建立第一張。" : "請 Editor 建立報表。"}
              </div>
            )}
            {reports && reports.length > 0 && filtered.length === 0 && (
              <div className="kn-empty">沒有符合「{filter}」的報表</div>
            )}
            {filtered.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`report-row ${selectedId === r.id ? "active" : ""}`}
                onClick={() => openRun(r)}
              >
                <span className="row-line">
                  <span className="row-title">{r.title}</span>
                  <span className="row-date">{r.updatedAt?.slice(0, 10)}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* 右：執行／編輯面板 */}
        <div className="detail-pane">
          {error && <div className="unreviewed-banner" style={{ marginBottom: 0 }}>{error}</div>}

          {!editing && !runTarget && (
            <div className="empty">從左側挑一張報表，填參數後執行——結果會顯示在這裡</div>
          )}

      {/* Editor form (Editor+ only) */}
      {editing && (
        <section className="report-editor">
          <h2>{editing.id == null ? "新增報表" : "編輯報表"}</h2>
          <label className="kn-field">
            報表名稱
            <input
              type="text"
              className="kn-input"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
              placeholder="例如：本月各產品類別營收"
            />
          </label>
          <label className="kn-field">
            SQL（唯讀，單一 SELECT；參數用 <code>:name</code>，日期區間用 <code>:name_start</code> / <code>:name_end</code>）
            <textarea
              className="kn-textarea mono"
              rows={8}
              value={editing.querySql}
              onChange={(e) => setEditing({ ...editing, querySql: e.target.value })}
              placeholder="SELECT ... WHERE created_at >= :start_date"
              spellCheck={false}
            />
          </label>

          <div className="report-params-edit">
            <div className="params-head">
              <span>參數</span>
              <button type="button" className="link-btn" onClick={addParam}>
                ＋ 新增參數
              </button>
            </div>
            {editing.params.length === 0 && <div className="kn-empty">尚無參數（此報表為固定查詢）。</div>}
            {editing.params.map((p, idx) => (
              <div key={idx} className="param-row">
                <input className="kn-input" placeholder="名稱 (:name)" value={p.name} onChange={(e) => updateParam(idx, { name: e.target.value })} />
                <select className="kn-select" value={p.type} onChange={(e) => updateParam(idx, { type: e.target.value as ParamType })}>
                  {(Object.keys(TYPE_LABEL) as ParamType[]).map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
                <input className="kn-input" placeholder="顯示標籤" value={p.label} onChange={(e) => updateParam(idx, { label: e.target.value })} />
                {p.type === "enum" && (
                  <input
                    className="kn-input"
                    placeholder="選項，用逗號分隔"
                    value={(p.options ?? []).join(",")}
                    onChange={(e) => updateParam(idx, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                  />
                )}
                {p.type !== "enum" && p.type !== "date_range" && (
                  <input className="kn-input" placeholder="預設值（可空）" value={p.default ?? ""} onChange={(e) => updateParam(idx, { default: e.target.value })} />
                )}
                <label className="param-required">
                  <input type="checkbox" checked={p.required} onChange={(e) => updateParam(idx, { required: e.target.checked })} />
                  必填
                </label>
                <button type="button" className="link-btn" onClick={() => removeParam(idx)}>
                  移除
                </button>
              </div>
            ))}
          </div>

          {/* Output mode + chart authoring */}
          <div className="report-chart-edit">
            <label className="kn-field">
              輸出模式
              <select
                className="kn-select"
                value={editing.outputMode}
                onChange={(e) => setEditing({ ...editing, outputMode: e.target.value as OutputMode })}
              >
                {OUTPUT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </label>

            {editing.outputMode !== "table" && (
              <div className="chart-authoring">
                <button type="button" className="link-btn" onClick={trialRun} disabled={trialing}>
                  {trialing ? "試跑中…" : "試跑取得欄位"}
                </button>
                {editing.trialColumns.length === 0 && editing.chartSpec && (
                  <div className="kn-empty">目前圖表：{editing.chartSpec.chart_type}，X={editing.chartSpec.x}，Y={editing.chartSpec.y.join("/")}。試跑以重新選欄位。</div>
                )}
                {editing.trialColumns.length > 0 && (
                  <>
                    <label className="kn-field">
                      圖表類型
                      <select
                        className="kn-select"
                        value={editing.chartSpec?.chart_type ?? "bar"}
                        onChange={(e) => updateSpec({ chart_type: e.target.value as ChartType })}
                      >
                        {REPORT_CHART_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {CHART_LABEL[t] ?? t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="kn-field">
                      X 軸欄位
                      <select className="kn-select" value={editing.chartSpec?.x ?? ""} onChange={(e) => updateSpec({ x: e.target.value })}>
                        <option value="">（請選擇）</option>
                        {editing.trialColumns.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="kn-field">
                      Y 軸（數值）欄位
                      <div className="y-checks">
                        {editing.trialColumns.map((c) => (
                          <label key={c} className="param-required">
                            <input type="checkbox" checked={editing.chartSpec?.y.includes(c) ?? false} onChange={() => toggleY(c)} />
                            {c}
                          </label>
                        ))}
                      </div>
                    </div>
                    <label className="kn-field">
                      圖表標題
                      <input className="kn-input" value={editing.chartSpec?.title ?? ""} onChange={(e) => updateSpec({ title: e.target.value })} />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="header-actions" style={{ justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "儲存中…" : "儲存"}
            </button>
          </div>
        </section>
      )}

      {/* Run view */}
      {runTarget && !editing && (
        <section className="report-result" style={{ border: "none", background: "transparent", padding: 0 }}>
          <div className="detail-head" style={{ marginBottom: 12 }}>
            <div className="detail-title">
              <b>{runTarget.title}</b>
              <span>輸出：{MODE_LABEL[runTarget.outputMode]}・參數 {runTarget.params.length} 個</span>
            </div>
            {canAuthor && (
              <div className="header-actions">
                <button type="button" className="btn" onClick={() => startEdit({ id: runTarget.id })}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M11.5 2.5L13.5 4.5L5.5 12.5L2.5 13.5L3.5 10.5L11.5 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  編輯
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => remove({ id: runTarget.id, title: runTarget.title })}
                >
                  刪除
                </button>
              </div>
            )}
          </div>

          {runTarget.params.length > 0 && (
            <div className="report-run-form">
              {runTarget.params.map((p) => (
                <label key={p.name} className="kn-field">
                  {p.label}
                  {p.required && <span className="req"> *</span>}
                  {p.type === "date_range" ? (
                    <span className="range-inputs">
                      <input
                        type="date"
                        className="kn-input"
                        value={(runValues[p.name] as { start?: string })?.start ?? ""}
                        onChange={(e) => setRunValues({ ...runValues, [p.name]: { ...(runValues[p.name] as object), start: e.target.value } })}
                      />
                      <span>～</span>
                      <input
                        type="date"
                        className="kn-input"
                        value={(runValues[p.name] as { end?: string })?.end ?? ""}
                        onChange={(e) => setRunValues({ ...runValues, [p.name]: { ...(runValues[p.name] as object), end: e.target.value } })}
                      />
                    </span>
                  ) : p.type === "enum" ? (
                    <select className="kn-select" value={String(runValues[p.name] ?? "")} onChange={(e) => setRunValues({ ...runValues, [p.name]: e.target.value })}>
                      <option value="">（請選擇）</option>
                      {(p.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={p.type === "date" ? "date" : p.type === "number" ? "number" : "text"}
                      className="kn-input"
                      value={String(runValues[p.name] ?? "")}
                      onChange={(e) => setRunValues({ ...runValues, [p.name]: e.target.value })}
                    />
                  )}
                </label>
              ))}
              <button type="button" className="btn btn-primary" onClick={() => doRun(runTarget.id, runValues)} disabled={running}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                  <path d="M4 2.5L13 8L4 13.5V2.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" fill="currentColor" />
                </svg>
                {running ? "執行中…" : "執行"}
              </button>
            </div>
          )}

          {running && <div className="kn-empty">執行中…</div>}
          {!running && result && result.rows.length === 0 && <div className="kn-empty">查詢成功，但沒有資料列。</div>}
          {!running && result && result.rows.length > 0 && (
            <>
              <div className="report-actions">
                <button type="button" className="btn" onClick={downloadCsv} disabled={exporting}>
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M8 2V10M8 10L5 7M8 10L11 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M2.5 12.5H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  {exporting ? "匯出中…" : "匯出 CSV"}
                </button>
                {showChart(runTarget.outputMode, runTarget.chartSpec) && (
                  <button type="button" className="btn" onClick={downloadPng}>
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                      <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
                      <circle cx="5.5" cy="5.5" r="1.2" stroke="currentColor" strokeWidth="1.2" />
                      <path d="M14 10L10.5 7L4 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    下載 PNG
                  </button>
                )}
              </div>
              {showChart(runTarget.outputMode, runTarget.chartSpec) && runTarget.chartSpec && (
                <Chart ref={chartRef} spec={runTarget.chartSpec} columns={result.columns} rows={result.rows} />
              )}
              {showTable(runTarget.outputMode, runTarget.chartSpec) && (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {result.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((row, i) => (
                        <tr key={i}>
                          {result.columns.map((c) => (
                            <td key={c}>{formatCell(row[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
        </div>
      </div>
    </AppShell>
  );
}
