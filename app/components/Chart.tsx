"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as echarts from "echarts";
import type { ChartSpec } from "@/lib/llm/types";

/** Imperative handle: lets a parent export the rendered chart as a PNG data URL. */
export interface ChartHandle {
  /** PNG data URL of the current chart, or null for a table (nothing to render). */
  toPng: () => string | null;
}

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 系列色（深色底、色盲安全驗證過的固定順序）：藍/橘/綠/黃/桃紅。 */
const SERIES_PALETTE = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];

/** Read a themed colour from the CSS variables so charts match the design tokens.
 *  Font is read from the resolved body font-family (canvas text can't consume
 *  raw `var()` references the way real CSS properties can). */
function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--text", "#e6e8ec"),
    muted: v("--text-muted", "#9aa1ac"),
    border: v("--border", "#24262c"),
    font: getComputedStyle(document.body).fontFamily || "sans-serif",
  };
}

/** Deterministic mapping from the narrow ChartSpec + rows to an ECharts option. */
function buildOption(spec: ChartSpec, rows: Row[]): echarts.EChartsOption {
  const { text, muted, border, font } = themeColors();
  const categories = rows.map((r) => String(r[spec.x] ?? ""));
  const common = {
    backgroundColor: "transparent",
    color: SERIES_PALETTE,
    title: {
      text: spec.title,
      left: "center",
      textStyle: { color: text, fontFamily: font },
    },
    tooltip: { trigger: spec.chart_type === "pie" ? "item" : "axis" },
    legend: { bottom: 0, textStyle: { color: muted } },
    grid: { left: 48, right: 24, top: 56, bottom: 48 },
  } as const;

  if (spec.chart_type === "pie") {
    const valueField = spec.y[0];
    return {
      ...common,
      series: [
        {
          type: "pie",
          radius: ["35%", "65%"],
          data: rows.map((r) => ({
            name: String(r[spec.x] ?? ""),
            value: num(r[valueField]),
          })),
        },
      ],
    };
  }

  const isArea = spec.chart_type === "area";
  const baseType = spec.chart_type === "line" || isArea ? "line" : "bar";
  return {
    ...common,
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: border } },
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: muted },
      axisLine: { lineStyle: { color: border } },
      splitLine: { lineStyle: { color: border, opacity: 0.4 } },
    },
    series: spec.y.map((field) => ({
      name: field,
      type: baseType,
      ...(isArea ? { areaStyle: { opacity: 0.15 } } : {}),
      data: rows.map((r) => num(r[field])),
    })),
  };
}

/** 表格儲存格顯示：數字加千分位、DECIMAL 字串（如 "782198493.0000"）去掉
 *  多餘小數；純整數字串（可能是編號/ID）原樣保留，避免編號被加逗號。 */
export function formatCell(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") {
    return Number.isFinite(v) ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v);
  }
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  if (/^-?\d+\.\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return s;
}

function DataTable({ columns, rows }: { columns: string[]; rows: Row[] }) {
  return (
    <div className="table-wrap chart-canvas">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c}>{formatCell(r[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Chart = forwardRef<
  ChartHandle,
  { spec: ChartSpec; columns: string[]; rows: Row[] }
>(function Chart({ spec, columns, rows }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const inst = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (spec.chart_type === "table" || !el.current) return;
    const chart = echarts.init(el.current);
    inst.current = chart;
    chart.setOption(buildOption(spec, rows));
    // Resize with the grid cell (drag-resize) as well as the window.
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      inst.current = null;
    };
  }, [spec, rows]);

  useImperativeHandle(
    ref,
    () => ({
      toPng: () =>
        inst.current
          ? inst.current.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#0f1013" })
          : null,
    }),
    [],
  );

  if (spec.chart_type === "table") {
    return <DataTable columns={columns} rows={rows} />;
  }
  return <div ref={el} className="chart-canvas" style={{ width: "100%" }} />;
});
