"use client";

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { ChartSpec } from "@/lib/llm/types";

type Row = Record<string, unknown>;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Read a themed colour from the CSS variables so charts match light/dark. */
function themeColors() {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    text: v("--text", "#e6e8ec"),
    muted: v("--text-muted", "#aab1c0"),
  };
}

/** Deterministic mapping from the narrow ChartSpec + rows to an ECharts option. */
function buildOption(spec: ChartSpec, rows: Row[]): echarts.EChartsOption {
  const { text, muted } = themeColors();
  const categories = rows.map((r) => String(r[spec.x] ?? ""));
  const common = {
    title: { text: spec.title, left: "center", textStyle: { color: text } },
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
    xAxis: { type: "category", data: categories, axisLabel: { color: muted } },
    yAxis: { type: "value", axisLabel: { color: muted } },
    series: spec.y.map((field) => ({
      name: field,
      type: baseType,
      ...(isArea ? { areaStyle: {} } : {}),
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
  // Bump to force a re-init when the theme flips (recolours axes/legend).
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((t) => t + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);

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
  }, [spec, rows, themeTick]);

  if (spec.chart_type === "table") {
    return <DataTable columns={columns} rows={rows} />;
  }
  return <div ref={ref} className="chart-canvas" style={{ width: "100%" }} />;
}
