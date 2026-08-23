"use client";

import { useCallback, useEffect, useState } from "react";
import type { CoverageStats } from "@/lib/schema/coverage";
import type { FailureStats } from "@/lib/state/queryFailures";

type StatsResponse = CoverageStats & { recentFailures: FailureStats | null };

const SCOPE_LABEL: Record<string, string> = { global: "全域", term: "術語", table: "表級" };
const STAGE_LABEL: Record<string, string> = {
  retrieval: "挑表",
  generate: "生成",
  readonly: "唯讀檢查",
  guardrail: "護欄",
  execute: "執行",
  timeout: "逾時",
  chart_repair: "圖表修復",
};

/**
 * 知識庫健檢：語意層對分析庫的覆蓋率一覽，常駐頁面頂部（不再折疊）。
 * 孤島表與「疑似 FK 但無關係」的欄位缺口，正是圖連通擴張失效、AI 只能
 * 瞎猜 JOIN 的地方——用警示色標出，並可重新整理。
 */
export function StatsPanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/knowledge/stats");
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "載入失敗");
        return;
      }
      setStats(d);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeTotal = stats ? stats.catalog.total - stats.catalog.excluded : 0;
  const islands = stats?.graph.isolatedTables.length ?? 0;
  const gaps = stats?.fkGaps.length ?? 0;

  return (
    <div className="stats-strip">
      {error && <div className="unreviewed-banner">{error}</div>}
      {!stats && !error && <div className="kn-empty">健檢統計中…</div>}

      {stats && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">
                {stats.catalog.described}
                <span style={{ fontSize: 14, color: "var(--text-dim)", fontWeight: 500 }}>
                  {" "}/ {stats.catalog.total}
                </span>
              </div>
              <div className="stat-label">
                表有描述・校對 {stats.catalog.reviewed}、排除 {stats.catalog.excluded}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.relationships.total}</div>
              <div className="stat-label">關係邊・已校對 {stats.relationships.reviewed}</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {stats.relationships.tablesWithEdges}
                <span style={{ fontSize: 14, color: "var(--text-dim)", fontWeight: 500 }}>
                  {" "}/ {activeTotal}
                </span>
              </div>
              <div className="stat-label">表已接上關係圖・連通區塊 {stats.graph.componentCount}</div>
            </div>
            <div className={`stat-card ${islands > 0 ? "warn" : ""}`}>
              <div className="stat-value">{islands}</div>
              <div className="stat-label">孤島表・沒有任何關係邊，AI 到不了</div>
            </div>
            <div className={`stat-card ${gaps > 0 ? "warn" : ""}`}>
              <div className="stat-value">{stats.analyticsAvailable ? gaps : "—"}</div>
              <div className="stat-label">疑似外鍵缺口・欄名像外鍵但沒有關係邊</div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <span className="kn-note">
              規則：
              {stats.rules
                .map((r) => `${SCOPE_LABEL[r.scope] ?? r.scope} ${r.total}（校對 ${r.reviewed}）`)
                .join("、")}
              {stats.recentFailures &&
                `・近 7 日查詢失敗 ${stats.recentFailures.total} 次` +
                  (stats.recentFailures.total > 0
                    ? `（${stats.recentFailures.byStage
                        .map((s) => `${STAGE_LABEL[s.stage] ?? s.stage} ${s.count}`)
                        .join("、")}）`
                    : "") +
                  `、自我修復 ${stats.recentFailures.repairs} 次`}
            </span>
            <button type="button" className="link-btn" onClick={load} disabled={busy}>
              {busy ? "統計中…" : "重新整理"}
            </button>
          </div>

          {!stats.analyticsAvailable && (
            <div className="unreviewed-banner" style={{ marginTop: 10 }}>
              分析資料庫連不上——欄位缺口清單暫時無法計算（其餘統計仍正確）。
            </div>
          )}

          {islands > 0 && (
            <details className="stats-sublist">
              <summary>
                孤島表 {islands} 張（無任何關係邊，跨表問題到不了它們）
              </summary>
              <ul>
                {stats.graph.isolatedTables.slice(0, 30).map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {islands > 30 && <li>… 其餘 {islands - 30} 張</li>}
              </ul>
            </details>
          )}

          {gaps > 0 && (
            <details className="stats-sublist">
              <summary>
                疑似外鍵缺口 {gaps} 個（欄名像外鍵、但沒有對應關係邊）
              </summary>
              <ul>
                {stats.fkGaps.slice(0, 30).map((g) => (
                  <li key={`${g.table}.${g.column}`}>
                    {g.table}.<b>{g.column}</b>（{g.dataType}）
                  </li>
                ))}
                {gaps > 30 && <li>… 其餘 {gaps - 30} 個</li>}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
