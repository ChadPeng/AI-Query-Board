"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chart, type ChartHandle } from "../components/Chart";
import { AppShell } from "../components/Sidebar";
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
 * 探索（BI 第三波點選版）：挑資料模型 → 左側欄位面板點維度/度量 → 加篩選 →
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
  { value: "eq", label: "是", values: 1 },
  { value: "neq", label: "不是", values: 1 },
  { value: "gte", label: "大於等於", values: 1 },
  { value: "lte", label: "小於等於", values: 1 },
  { value: "between", label: "介於", values: 2 },
  { value: "in", label: "是其中一個", values: "list" },
  { value: "contains", label: "文字包含", values: 1 },
];
/** 有值標籤的欄位只留得懂的比較方式（選項式，不用打代碼） */
const LABELED_OPS: ReadonlySet<FilterOp> = new Set(["eq", "neq", "in"]);

const AGG_SHORT: Record<string, string> = {
  sum: "加總",
  avg: "平均",
  count: "筆數",
  count_distinct: "去重筆數",
  min: "最小",
  max: "最大",
};

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: "bar", label: "長條" },
  { value: "line", label: "折線" },
  { value: "area", label: "面積" },
  { value: "pie", label: "圓餅" },
  { value: "table", label: "表格" },
];

interface FilterRow {
  fieldId: number;
  op: FilterOp;
  v1: string;
  v2: string;
}

const DAY_MS = 86_400_000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

const TIME_PRESETS = [
  { key: "d30", label: "近 30 天", days: 30 },
  { key: "d90", label: "近 90 天", days: 90 },
  { key: "d180", label: "近半年", days: 180 },
  { key: "y1", label: "近一年", days: 365 },
] as const;

export default function ExplorePage() {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [model, setModel] = useState<DatasetModel | null>(null);
  const [dimId, setDimId] = useState<number | "">("");
  const [dim2Id, setDim2Id] = useState<number | "">(""); // 顏色/系列（第二維度）
  const [bucket, setBucket] = useState<DateBucket | "">("");
  const [measureIds, setMeasureIds] = useState<number[]>([]);
  const [filters, setFilters] = useState<FilterRow[]>([]);
  const [sortBy, setSortBy] = useState<string>(""); // "" | "dim" | "m:<fieldId>"
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 時間區間（取代筆數上限的治理手段）：預設近一年、最長一年
  const [timeDimId, setTimeDimId] = useState<number | "">("");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  const [timePreset, setTimePreset] = useState<string>("y1");
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
  const dim2Field: DatasetFieldDef | undefined = dimensions.find((f) => f.id === dim2Id);
  const isTemporal = dimField?.dataType ? TEMPORAL_TYPES.has(dimField.dataType) : false;
  const temporalDims = useMemo(
    () => dimensions.filter((f) => f.dataType != null && TEMPORAL_TYPES.has(f.dataType)),
    [dimensions],
  );
  // 一般篩選不含時間欄位——時間由上方的「時間區間」統一控制，避免兩套混淆
  const filterableDims = useMemo(
    () => dimensions.filter((f) => !(f.dataType != null && TEMPORAL_TYPES.has(f.dataType))),
    [dimensions],
  );
  // 顏色維度只在「一個 X 維度＋恰好一個度量」時有意義（樞紐成多序列）
  const canUseDim2 = dimId !== "" && measureIds.length === 1 && dimensions.length > 1;

  async function pickDataset(id: string) {
    setModel(null);
    setResult(null);
    setSpec(null);
    setError(null);
    setDimId("");
    setDim2Id("");
    setBucket("");
    setMeasureIds([]);
    setFilters([]);
    setSortBy("");
    if (!id) return;
    const res = await fetch(`/api/datasets/${id}`);
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "載入模型失敗");
      return;
    }
    setModel(d.dataset);
    // 時間窗初始化：掛在第一個時間維度上，預設近一年（伺服器端也會強制）
    const firstTemporal = (d.dataset.fields as DatasetFieldDef[]).find(
      (f) => f.kind === "dimension" && f.dataType != null && TEMPORAL_TYPES.has(f.dataType),
    );
    setTimeDimId(firstTemporal?.id ?? "");
    setTimeEnd(isoDay(Date.now()));
    setTimeStart(isoDay(Date.now() - 365 * DAY_MS));
    setTimePreset("y1");
  }

  /** 設定時間區間並夾在一年內（起訖顛倒自動對調、超過一年自動壓回）。 */
  function setRange(start: string, end: string, preset: string) {
    let s = start;
    let e = end;
    if (s && e && s > e) [s, e] = [e, s];
    if (s && e && Date.parse(e) - Date.parse(s) > 365 * DAY_MS) {
      s = isoDay(Date.parse(e) - 365 * DAY_MS);
      setMsg("時間區間最長一年，已自動調整起日");
    }
    setTimeStart(s);
    setTimeEnd(e);
    setTimePreset(preset);
  }

  function toggleMeasure(id: number) {
    setMeasureIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length !== 1) setDim2Id(""); // 顏色維度需要恰好一個度量
      if (!next.includes(id) && sortBy === `m:${id}`) setSortBy("");
      return next;
    });
  }

  /** 組出目前選擇對應的查詢；不完整的篩選列直接略過（即時出圖時不打斷使用者輸入）。 */
  const buildQuery = useCallback((): ExplorerQuery | null => {
    if (!model) return null;
    if (dimId === "" && measureIds.length === 0) return null;
    const dims: ExplorerQuery["dimensions"] = [];
    if (dimId !== "") {
      dims.push({ fieldId: dimId, dateBucket: isTemporal && bucket ? bucket : undefined });
      if (dim2Id !== "" && dim2Id !== dimId && measureIds.length === 1) {
        dims.push({ fieldId: dim2Id });
      }
    }
    let sort: ExplorerQuery["sort"];
    if (sortBy === "dim" && dimId !== "") {
      sort = { by: "dimension", dir: sortDir };
    } else if (sortBy.startsWith("m:")) {
      const idx = measureIds.indexOf(Number(sortBy.slice(2)));
      if (idx >= 0) sort = { by: idx, dir: sortDir };
    }
    const query: ExplorerQuery = {
      dimensions: dims,
      measures: measureIds.map((fieldId) => ({ fieldId })),
      filters: [],
      sort,
    };
    if (timeDimId !== "" && timeStart && timeEnd) {
      query.filters.push({
        fieldId: timeDimId,
        op: "between",
        values: [timeStart, `${timeEnd} 23:59:59`],
      });
    }
    for (const f of filters) {
      if (f.fieldId === 0) continue;
      const op = OPS.find((o) => o.value === f.op)!;
      let values: (string | number)[];
      if (op.values === "list") {
        values = f.v1.split(",").map((s) => s.trim()).filter(Boolean);
        if (values.length === 0) continue;
      } else if (op.values === 2) {
        if (!f.v1 || !f.v2) continue;
        values = [f.v1, f.v2];
      } else {
        if (!f.v1) continue;
        values = [f.v1];
      }
      query.filters.push({ fieldId: f.fieldId, op: f.op, values });
    }
    return query;
  }, [model, dimId, dim2Id, measureIds, filters, isTemporal, bucket, sortBy, sortDir, timeDimId, timeStart, timeEnd]);

  const buildSpec = useCallback(
    (columns: string[], type: ChartType): ChartSpec | null => {
      if (!model) return null;
      const dimName = dimField?.name;
      const yNames = measureIds
        .map((id) => measures.find((m) => m.id === id)?.name)
        .filter((n): n is string => !!n);
      return {
        chart_type: dimName && yNames.length > 0 ? type : "table",
        x: dimName ?? columns[0] ?? "",
        y: yNames.length > 0 ? yNames : columns.slice(1),
        title: `${model.name}${dimName ? `：${yNames.join("、")}・依${dimName}` : ""}`,
        aggregation: "none",
      };
    },
    [model, dimField, measureIds, measures],
  );

  // 防競態：只採用最後一次送出的查詢結果
  const runSeq = useRef(0);

  const run = useCallback(async () => {
    if (!model) return;
    const query = buildQuery();
    if (!query) {
      setResult(null);
      setSpec(null);
      return;
    }
    const seq = ++runSeq.current;
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
      if (seq !== runSeq.current) return; // 已有更新的查詢在跑
      if (!res.ok) {
        setError(d.error ?? "查詢失敗");
        return;
      }
      setResult({ columns: d.columns, rows: d.rows, sql: d.sql });
      setSpec(buildSpec(d.columns, chartType));
    } finally {
      if (seq === runSeq.current) setBusy(false);
    }
  }, [model, buildQuery, buildSpec, chartType]);

  // 即時出圖：選擇一變就自動查詢（查詢由模型確定性編譯，成本低），400ms 防抖
  useEffect(() => {
    if (!model) return;
    const t = setTimeout(run, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, dimId, dim2Id, bucket, measureIds, filters, sortBy, sortDir, timeDimId, timeStart, timeEnd]);

  // 切換圖表類型不重查——直接以現有結果重建圖表規格
  useEffect(() => {
    if (result) setSpec(buildSpec(result.columns, chartType));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // 維度值標籤：代碼→顯示名（資料模型上維護），只動顯示層、查詢仍用原始值
  const labeledRows = useMemo(() => {
    if (!result) return [];
    const maps: [string, Record<string, string>][] = [];
    if (dimField?.valueLabels) maps.push([dimField.name, dimField.valueLabels]);
    if (dim2Field?.valueLabels) maps.push([dim2Field.name, dim2Field.valueLabels]);
    if (maps.length === 0) return result.rows;
    return result.rows.map((r) => {
      const o: Record<string, unknown> = { ...r };
      for (const [name, m] of maps) {
        const raw = o[name];
        if (raw != null && m[String(raw)] != null) o[name] = m[String(raw)];
      }
      return o;
    });
  }, [result, dimField, dim2Field]);

  // 顏色維度：把「X×顏色→值」的長表在前端樞紐成多序列（同 Tableau 的 Color）。
  // 系列取總量前 5 名（配色只驗證過 5 色，不循環重複），其餘略過並提示。
  const pivot = useMemo(() => {
    if (!result || !spec || !model) return null;
    if (dim2Id === "" || !dimField || !dim2Field || measureIds.length !== 1) return null;
    if (spec.chart_type === "table" || spec.chart_type === "pie") return null;
    const mName = measures.find((m) => m.id === measureIds[0])?.name;
    if (!mName) return null;
    const d1 = dimField.name;
    const d2 = dim2Field.name;
    const xs: string[] = [];
    const xSeen = new Set<string>();
    const totals = new Map<string, number>();
    for (const r of labeledRows) {
      const x = String(r[d1] ?? "");
      if (!xSeen.has(x)) {
        xSeen.add(x);
        xs.push(x);
      }
      const s = String(r[d2] ?? "");
      totals.set(s, (totals.get(s) ?? 0) + Math.abs(Number(r[mName]) || 0));
    }
    const seriesAll = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const series = seriesAll.slice(0, 5);
    const sSet = new Set(series);
    const byX = new Map<string, Record<string, unknown>>(xs.map((x) => [x, { [d1]: x }]));
    for (const r of labeledRows) {
      const s = String(r[d2] ?? "");
      if (!sSet.has(s)) continue;
      byX.get(String(r[d1] ?? ""))![s] = Number(r[mName]) || 0;
    }
    return {
      columns: [d1, ...series],
      rows: xs.map((x) => byX.get(x)!),
      spec: {
        ...spec,
        x: d1,
        y: series,
        title: `${model.name}：${mName}・依${d1}×${d2}`,
      } as ChartSpec,
      dropped: seriesAll.length - series.length,
    };
  }, [result, spec, model, dim2Id, dimField, dim2Field, measureIds, measures, labeledRows]);

  const displaySpec = pivot ? pivot.spec : spec;
  const displayColumns = pivot ? pivot.columns : result?.columns ?? [];
  const displayRows = pivot ? pivot.rows : labeledRows;

  async function pin() {
    if (!result || !displaySpec || !model) return;
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: displaySpec.title,
        chartSpec: displaySpec,
        columns: displayColumns,
        rows: displayRows,
        sql: result.sql,
        question: `（探索）${displaySpec.title}`,
      }),
    });
    setMsg(res.ok ? "已釘上儀表板" : "釘選失敗");
  }

  return (
    <AppShell
      active="explore"
      title="探索"
      subtitle="選好分析角度與數字，圖表即時更新"
      bleed
      actions={
        <span className="pill-note">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L14 4.5V8C14 11.5 11.5 13.9 8 14.5C4.5 13.9 2 11.5 2 8V4.5L8 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            <path d="M5.5 8L7.5 10L10.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          只讀取資料・不會改動任何東西
        </span>
      }
    >
      <div className="explore-grid">
        {/* 欄位面板 */}
        <aside className="field-panel">
          <div className="fp-section">
            <span className="fp-label">資料模型</span>
            <select className="kn-select" value={model?.id ?? ""} onChange={(e) => pickDataset(e.target.value)}>
              <option value="">選擇資料模型…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.published ? "" : "（草稿）"}
                </option>
              ))}
            </select>
            {datasets.length === 0 && (
              <span className="kn-note">還沒有資料模型——請 Editor 到「資料模型」頁建立並發佈。</span>
            )}
            {model?.description && <span className="kn-note">{model.description}</span>}
          </div>

          {model && (
            <>
              <div className="fp-section">
                <span className="fp-label">分析角度（維度）・想按什麼分組</span>
                <button
                  type="button"
                  className={`field-row ${dimId === "" ? "selected" : ""}`}
                  onClick={() => {
                    setDimId("");
                    setDim2Id("");
                    setBucket("");
                    if (sortBy === "dim") setSortBy("");
                  }}
                >
                  <span className="grow">不分組（只看總計）</span>
                </button>
                {dimensions.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`field-row ${dimId === f.id ? "selected" : ""}`}
                    onClick={() => {
                      setDimId(f.id!);
                      if (dim2Id === f.id) setDim2Id("");
                      setBucket("");
                    }}
                  >
                    <span className="grow">{f.name}</span>
                    {TEMPORAL_TYPES.has(f.dataType ?? "") && (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ opacity: 0.7, flexShrink: 0 }}>
                        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
                        <path d="M8 4.5V8L10.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    )}
                    {dimId === f.id && (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M2.5 8.5L6.5 12.5L13.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              <div className="fp-section">
                <span className="fp-label">數字指標（度量）・想看什麼數字，可複選</span>
                {measures.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className={`field-row ${measureIds.includes(f.id!) ? "selected" : ""}`}
                    onClick={() => toggleMeasure(f.id!)}
                  >
                    <span className="grow">{f.name}</span>
                    <span className="dim-note">{AGG_SHORT[f.aggregation ?? ""] ?? ""}</span>
                    {measureIds.includes(f.id!) && (
                      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
                        <path d="M2.5 8.5L6.5 12.5L13.5 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>

        {/* 設定＋結果 */}
        <div className="explore-main">
          {error && <div className="unreviewed-banner" style={{ marginBottom: 0 }}>{error}</div>}
          {msg && <div className="badge">{msg}</div>}

          {model && (
            <>
              <div className="config-row">
                {isTemporal && (
                  <div className="config-group">
                    <span className="cg-label">時間單位</span>
                    <div className="seg-control inner">
                      <button
                        type="button"
                        className={`seg ${bucket === "" ? "active" : ""}`}
                        onClick={() => setBucket("")}
                      >
                        不分段
                      </button>
                      {BUCKETS.map((b) => (
                        <button
                          key={b.value}
                          type="button"
                          className={`seg ${bucket === b.value ? "active" : ""}`}
                          onClick={() => setBucket(b.value)}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {canUseDim2 && (
                  <div className="config-group">
                    <span className="cg-label">顏色</span>
                    <select
                      className="kn-select"
                      value={dim2Id}
                      onChange={(e) => {
                        const v = e.target.value === "" ? "" : Number(e.target.value);
                        if (v !== "" && chartType === "pie") setChartType("bar");
                        setDim2Id(v);
                      }}
                    >
                      <option value="">（無）</option>
                      {dimensions
                        .filter((f) => f.id !== dimId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                )}

                <div className="config-group">
                  <span className="cg-label">排序</span>
                  <select className="kn-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="">預設</option>
                    {dimId !== "" && dimField && <option value="dim">依{dimField.name}</option>}
                    {measureIds.map((id) => {
                      const m = measures.find((x) => x.id === id);
                      return m ? (
                        <option key={id} value={`m:${id}`}>
                          依{m.name}
                        </option>
                      ) : null;
                    })}
                  </select>
                  {sortBy !== "" && (
                    <div className="seg-control inner">
                      <button type="button" className={`seg ${sortDir === "desc" ? "active" : ""}`} onClick={() => setSortDir("desc")}>
                        大→小
                      </button>
                      <button type="button" className={`seg ${sortDir === "asc" ? "active" : ""}`} onClick={() => setSortDir("asc")}>
                        小→大
                      </button>
                    </div>
                  )}
                </div>

                {temporalDims.length > 0 && (
                  <div className="config-group">
                    <span className="cg-label">時間區間</span>
                    {temporalDims.length > 1 ? (
                      <select
                        className="kn-select"
                        value={timeDimId}
                        onChange={(e) => setTimeDimId(e.target.value === "" ? "" : Number(e.target.value))}
                      >
                        {temporalDims.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                        {temporalDims[0].name}
                      </span>
                    )}
                    <div className="seg-control inner">
                      {TIME_PRESETS.map((p) => (
                        <button
                          key={p.key}
                          type="button"
                          className={`seg ${timePreset === p.key ? "active" : ""}`}
                          onClick={() => setRange(isoDay(Date.now() - p.days * DAY_MS), isoDay(Date.now()), p.key)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <input
                      type="date"
                      className="kn-input"
                      value={timeStart}
                      onChange={(e) => setRange(e.target.value, timeEnd, "custom")}
                      style={{ padding: "5px 8px" }}
                    />
                    <span style={{ color: "var(--text-dim)" }}>～</span>
                    <input
                      type="date"
                      className="kn-input"
                      value={timeEnd}
                      onChange={(e) => setRange(timeStart, e.target.value, "custom")}
                      style={{ padding: "5px 8px" }}
                    />
                  </div>
                )}

                <div style={{ flex: 1 }} />

                <div className="seg-control">
                  {CHART_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      className={`seg ${chartType === t.value ? "active" : ""}`}
                      onClick={() => {
                        if (t.value === "pie" && dim2Id !== "") {
                          setDim2Id("");
                          setMsg("圓餅圖不支援顏色維度，已自動移除");
                        }
                        setChartType(t.value);
                      }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {busy && <span className="kn-note">查詢中…</span>}
                <button type="button" className="btn" onClick={run} disabled={busy} title="重新查詢一次">
                  <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                    <path d="M13.5 8C13.5 11 11 13.5 8 13.5C5 13.5 2.5 11 2.5 8C2.5 5 5 2.5 8 2.5C10.2 2.5 12.1 3.8 13 5.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M13.5 2.5V6H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  重新整理
                </button>
              </div>

              <div className="config-group" style={{ alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
                <span className="cg-label">篩選條件</span>
                {filters.map((f, i) => {
                  const ff = dimensions.find((d) => d.id === f.fieldId);
                  const labels = ff?.valueLabels ?? null;
                  const ops = labels ? OPS.filter((o) => LABELED_OPS.has(o.value)) : OPS;
                  const setF = (patch: Partial<FilterRow>) =>
                    setFilters((fs) => fs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                  const picked = f.v1.split(",").map((s) => s.trim()).filter(Boolean);
                  return (
                    <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        className="kn-select"
                        value={f.fieldId}
                        onChange={(e) => setF({ fieldId: Number(e.target.value), op: "eq", v1: "", v2: "" })}
                      >
                        <option value={0}>選擇欄位…</option>
                        {filterableDims.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      {f.fieldId !== 0 && (
                        <select
                          className="kn-select"
                          value={f.op}
                          onChange={(e) => setF({ op: e.target.value as FilterOp, v2: "" })}
                        >
                          {ops.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}

                      {/* 有值標籤 → 直接選中文選項，不用打代碼 */}
                      {f.fieldId !== 0 && labels && (f.op === "eq" || f.op === "neq") && (
                        <select className="kn-select" value={f.v1} onChange={(e) => setF({ v1: e.target.value })}>
                          <option value="">選擇…</option>
                          {Object.entries(labels).map(([code, label]) => (
                            <option key={code} value={code}>
                              {label}
                            </option>
                          ))}
                        </select>
                      )}
                      {f.fieldId !== 0 && labels && f.op === "in" && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {Object.entries(labels).map(([code, label]) => {
                            const on = picked.includes(code);
                            return (
                              <button
                                key={code}
                                type="button"
                                className={`chip-toggle ${on ? "active" : ""}`}
                                onClick={() =>
                                  setF({ v1: (on ? picked.filter((c) => c !== code) : [...picked, code]).join(",") })
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* 沒有值標籤 → 手動輸入 */}
                      {f.fieldId !== 0 && !labels && (
                        <>
                          <input
                            className="kn-input"
                            style={{ maxWidth: 220 }}
                            placeholder={f.op === "in" ? "多個值用逗號分隔" : "值"}
                            value={f.v1}
                            onChange={(e) => setF({ v1: e.target.value })}
                          />
                          {f.op === "between" && (
                            <input
                              className="kn-input"
                              style={{ maxWidth: 220 }}
                              placeholder="到"
                              value={f.v2}
                              onChange={(e) => setF({ v2: e.target.value })}
                            />
                          )}
                        </>
                      )}
                      <button className="link-btn" onClick={() => setFilters((fs) => fs.filter((_, j) => j !== i))}>
                        移除
                      </button>
                    </div>
                  );
                })}
                <button
                  className="link-btn"
                  onClick={() => setFilters((fs) => [...fs, { fieldId: 0, op: "eq", v1: "", v2: "" }])}
                >
                  ＋ 加一個條件
                </button>
              </div>
            </>
          )}

          {!model && !error && (
            <div className="empty">先在左側選一個資料模型</div>
          )}

          {model && !result && !error && (
            <div className="empty">點選左側的分析角度或數字指標，圖會即時更新</div>
          )}

          {result && displaySpec && (
            <div className="chart-card preview">
              <div className="card-bar">
                <span className="badge" style={{ color: "var(--text-dim)" }}>
                  共 {result.rows.length.toLocaleString("en-US")} 筆資料
                  {result.rows.length >= 50000 && "・資料量太大只顯示部分，請縮小時間區間"}
                  {pivot && pivot.dropped > 0 && `・顏色僅顯示前 5 大類（其餘 ${pivot.dropped} 類未畫出）`}
                </span>
                <span className="header-actions">
                  <button type="button" className="pin" onClick={pin}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M9.5 2L14 6.5L11 7.5L8.5 12.5L7 11L3.5 14.5L1.5 12.5L5 9L3.5 7.5L8.5 5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    釘上儀表板
                  </button>
                </span>
              </div>
              <Chart ref={chartRef} spec={displaySpec} columns={displayColumns} rows={displayRows} />
              <details className="sql">
                <summary>技術細節（SQL 查詢語法，給工程師看的）</summary>
                <pre>{result.sql}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
