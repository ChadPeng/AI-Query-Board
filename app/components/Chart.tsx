"use client";

import { useEffect, useRef } from "react";
import * as echarts from "echarts";
import type { ChartSpec } from "@/lib/llm/types";

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Cyberpunk neon series palette — green/magenta/cyan/amber/red, in that order. */
const NEON_PALETTE = ["#00ff88", "#ff00ff", "#00d4ff", "#ffaa00", "#ff3366"];

/** Read a themed colour from the CSS variables so charts match the design tokens.
 *  Font is read from the resolved body font-family (canvas text can't consume
 *  raw `var()` references the way real CSS properties can). */
function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--text", "#e0e0e0"),
    muted: v("--text-muted", "#8b93a3"),
    border: v("--border", "#2a2a3a"),
    font: getComputedStyle(document.body).fontFamily || "monospace",
  };
}

/** Deterministic mapping from the narrow ChartSpec + rows to an ECharts option. */
function buildOption(spec: ChartSpec, rows: Row[]): echarts.EChartsOption {
  const { text, muted, border, font } = themeColors();
  const categories = rows.map((r) => String(r[spec.x] ?? ""));
  const common = {
    backgroundColor: "transparent",
    color: NEON_PALETTE,
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
                <td key={c}>{String(r[c] ?? "")}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Chart({
  spec,
  columns,
  rows,
}: {
  spec: ChartSpec;
  columns: string[];
  rows: Row[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (spec.chart_type === "table" || !ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(buildOption(spec, rows));
    // Resize with the grid cell (drag-resize) as well as the window.
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  }, [spec, rows]);

  if (spec.chart_type === "table") {
    return <DataTable columns={columns} rows={rows} />;
  }
  return <div ref={ref} className="chart-canvas" style={{ width: "100%" }} />;
}
