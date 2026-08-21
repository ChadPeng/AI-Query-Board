"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Chart, type ChartHandle } from "../components/Chart";
import type { ChartSpec, ChartType } from "@/lib/llm/types";
import type {
  DatasetFieldDef,
  DatasetMeta,
  DatasetModel,
  DateBucket,
  ExplorerQuery,
  FilterOp,
} from "@/lib/datasets/types";
import { TEMPORAL_TYPES } from "@/lib/datasets/types";

/**
 * 探索（BI 第三波點選版）：挑資料模型 → 維度上 X 軸、度量上 Y 軸、加篩選 →
 * 查詢由編譯器確定性產生（零 LLM、零幻覺）→ ECharts 出圖 → 可釘上儀表板。
 */

interface RunResult {
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
}

const BUCKETS: { value: DateBucket; label: string }[] = [
  { value: "day", label: "日" },
  { value: "week", label: "週" },
  { value: "month", label: "月" },
  { value: "quarter", label: "季" },
  { value: "year", label: "年" },
];

const OPS: { value: FilterOp; label: string; values: 1 | 2 | "list" }[] = [
  { value: "eq", label: "=", values: 1 },
  { value: "neq", label: "≠", values: 1 },
  { value: "gte", label: "≥", values: 1 },
  { value: "lte", label: "≤", values: 1 },
  { value: "between", label: "介於", values: 2 },
  { value: "in", label: "屬於（逗號分隔）", values: "list" },
  { value: "contains", label: "包含", values: 1 },
];

const CHART_TYPES: ChartType[] = ["bar", "line", "area", "pie", "table"];

interface FilterRow {
  fieldId: number;
  op: FilterOp;
  v1: string;
  v2: string;
}

export default function ExplorePage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [model, setModel] = useState<DatasetModel | null>(null);
  const [dimId, setDimId] = useState<number | "">("");
  const [bucket, setBucket] = useState<DateBucket | "">("");
  const [measureIds, setMeasureIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [result, setResult] = useState<RunResult | null>(null);
  const [spec, setSpec] = useState<ChartSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chartRef = useRef<ChartHandle>(null);

  useEffect(() => {
    fetch("/api/datasets")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDatasets(d?.datasets ?? []))
      .catch(() => {});
  }, []);

  const dimensions = useMemo(
    () => model?.fields.filter((f) => f.kind === "dimension") ?? [],
    [model],
  );
  const measures = useMemo(() => model?.fields.filter((f) => f.kind === "measure") ?? [], [model]);
  const dimField: DatasetFieldDef | undefined = dimensions.find((f) => f.id === dimId);
  const isTemporal = dimField?.dataType ? TEMPORAL_TYPES.has(dimField.dataType) : false;

  async function pickDataset(id: string) {
    setModel(null);
    setResult(null);
    setSpec(null);
    setError(null);
    setDimId("");
    setBucket("");
    setMeasureIds([]);
    setFilters([]);
    if (!id) return;
    const res = await fetch(`/api/datasets/${id}`);
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "載入模型失敗");
      return;
    }
    setModel(d.dataset);
  }

  function toggleMeasure(id: number) {
    setMeasureIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function buildQuery(): ExplorerQuery | string {
    if (!model) return "請先選資料模型";
    if (dimId === "" && measureIds.length === 0) return "至少選一個維度或度量";
    const query: ExplorerQuery = {
      dimensions:
        dimId === ""
          ? []
          : [{ fieldId: dimId, dateBucket: isTemporal && bucket ? bucket : undefined }],
      measures: measureIds.map((fieldId) => ({ fieldId })),
      filters: [],
    };
    for (const f of filters) {
      if (f.fieldId === 0) continue;
      const op = OPS.find((o) => o.value === f.op)!;
      let values: (string | number)[];
      if (op.values === "list") {
        values = f.v1.split(",").map((s) => s.trim()).filter(Boolean);
        if (values.length === 0) return "「屬於」篩選至少要一個值";
      } else if (op.values === 2) {
        if (!f.v1 || !f.v2) return "「介於」篩選需要兩個值";
        values = [f.v1, f.v2];
      } else {
        if (!f.v1) return "篩選缺少值";
        values = [f.v1];
      }
      query.filters.push({ fieldId: f.fieldId, op: f.op, values });
    }
    return query;
  }

  async function run() {
    if (!model) return;
    const query = buildQuery();
    if (typeof query === "string") {
      setError(query);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/datasets/${model.id}/query`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "查詢失敗");
        return;
      }
      setResult({ columns: d.columns, rows: d.rows, sql: d.sql });
      const dimName = dimField?.name;
      const yNames = measureIds
        .map((id) => measures.find((m) => m.id === id)?.name)
        .filter((n): n is string => !!n);
      setSpec({
        chart_type: dimName && yNames.length > 0 ? chartType : "table",
        x: dimName ?? d.columns[0] ?? "",
        y: yNames.length > 0 ? yNames : d.columns.slice(1),
        title: `${model.name}${dimName ? `：${yNames.join("、")} by ${dimName}` : ""}`,
        aggregation: "none",
      });
    } finally {
      setBusy(false);
    }
  }

  async function pin() {
    if (!result || !spec || !model) return;
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: spec.title,
        chartSpec: spec,
        columns: result.columns,
        rows: result.rows,
        sql: result.sql,
        question: `（探索）${spec.title}`,
      }),
    });
    setMsg(res.ok ? "✓ 已釘上儀表板" : "釘選失敗");
  }

  return (
    <main className="knowledge">
      <div className="kn-top">
        <h1 className="cyber-glitch" data-text="探索">
          探索
        </h1>
        <span className="header-actions">
          <Link href="/models" className="link-btn">
            資料模型
          </Link>
          <Link href="/" className="link-btn">
            ← 回儀表板
          </Link>
        </span>
      </div>
      <p className="kn-sub">
        在資料模型上點選出圖：維度上 X 軸、度量上 Y 軸。查詢由模型確定性產生——不經 AI、不會猜錯
        JOIN。結果可直接釘上儀表板。
      </p>

      {error && <div className="unreviewed-banner">{error}</div>}
      {msg && <div className="badge">{msg}</div>}

      <section className="report-editor">
        <label className="kn-field">
          資料模型
          <select className="kn-select" value={model?.id ?? ""} onChange={(e) => pickDataset(e.target.value)}>
            <option value="">選擇資料模型…</option>
            {datasets.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.published ? "" : "（草稿）"}
              </option>
            ))}
          </select>
        </label>
        {datasets.length === 0 && (
          <p className="kn-note">
            還沒有資料模型——請 Editor 到「資料模型」頁建立並發佈。
          </p>
        )}

        {model && (
          <>
            <label className="kn-field">
              X 軸（維度）
              <select
                className="kn-select"
                value={dimId}
                onChange={(e) => {
                  setDimId(e.target.value === "" ? "" : Number(e.target.value));
                  setBucket("");
                }}
              >
                <option value="">（不分組——只看總計）</option>
                {dimensions.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {isTemporal && (
              <label className="kn-field">
                時間粒度
                <select className="kn-select" value={bucket} onChange={(e) => setBucket(e.target.value as DateBucket | "")}>
                  <option value="">原始值</option>
                  {BUCKETS.map((b) => (
                    <option key={b.value} value={b.value}>
                      按{b.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="kn-field">
              Y 軸（度量，可複選）
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 6 }}>
                {measures.map((f) => (
                  <label key={f.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={measureIds.includes(f.id!)}
                      onChange={() => toggleMeasure(f.id!)}
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="kn-field">
              篩選
              {filters.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <select
                    className="kn-select"
                    value={f.fieldId}
                    onChange={(e) =>
                      setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, fieldId: Number(e.target.value) } : x)))
                    }
                  >
                    <option value={0}>欄位…</option>
                    {dimensions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="kn-select"
                    value={f.op}
                    onChange={(e) =>
                      setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, op: e.target.value as FilterOp } : x)))
                    }
                  >
                    {OPS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    className="kn-input"
                    style={{ maxWidth: 220 }}
                    placeholder="值"
                    value={f.v1}
                    onChange={(e) =>
                      setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, v1: e.target.value } : x)))
                    }
                  />
                  {f.op === "between" && (
                    <input
                      className="kn-input"
                      style={{ maxWidth: 220 }}
                      placeholder="到"
                      value={f.v2}
                      onChange={(e) =>
                        setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, v2: e.target.value } : x)))
                      }
                    />
                  )}
                  <button className="link-btn" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>
                    移除
                  </button>
                </div>
              ))}
              <div style={{ marginTop: 6 }}>
                <button
                  className="link-btn"
                  onClick={() => setFilters((fs) => [...fs, { fieldId: 0, op: "eq", v1: "", v2: "" }])}
                >
                  ＋ 新增篩選
                </button>
              </div>
            </div>

            <div className="kn-field">
              圖表類型
              <div className="tabs" style={{ marginTop: 6 }}>
                {CHART_TYPES.map((t) => (
                  <button
                    key={t}
                    className={`tab ${chartType === t ? "active" : ""}`}
                    onClick={() => setChartType(t)}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>

            <div className="header-actions" style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={run} disabled={busy}>
                {busy ? "查詢中…" : "▶ 執行"}
              </button>
            </div>
          </>
        )}
      </section>

      {result && spec && (
        <div className="chart-card preview cyber-holographic">
          <div className="card-bar">
            <span className="badge">
              {result.rows.length} 列（確定性查詢，未經 AI）
            </span>
            <span className="header-actions">
              <button type="button" className="pin" onClick={pin}>
                📌 釘上儀表板
              </button>
            </span>
          </div>
          <Chart ref={chartRef} spec={spec} columns={result.columns} rows={result.rows} />
          <details className="sql">
            <summary>生成的 SQL</summary>
            <pre>{result.sql}</pre>
          </details>
        </div>
      )}
    </main>
  );
}
