"use client";

import { useState } from "react";
import type { CoverageStats } from "@/lib/schema/coverage";
import type { FailureStats } from "@/lib/state/queryFailures";

type StatsResponse = CoverageStats & { recentFailures: FailureStats | null };

const SCOPE_LABEL: Record<string, string> = { global: "全域", term: "術語", table: "表" };
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
 * 知識庫健檢：語意層對分析庫的覆蓋率一覽。孤島表與「疑似 FK 但無關係」
 * 的欄位缺口，正是圖連通擴張失效、AI 只能瞎猜 JOIN 的地方。
 * 統計要多打一次 analytics 的 information_schema，所以展開時才載入。
 */
export function StatsPanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (stats || busy) return;
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
  }

  const activeTotal = stats ? stats.catalog.total - stats.catalog.excluded : 0;

  return (
    <details
      className="learn-panel cyber-chamfer"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) load();
      }}
    >
      <summary>
        <span className="cyber-terminal-dots" aria-hidden="true">
          <span className="cyber-dot red" />
          <span className="cyber-dot yellow" />
          <span className="cyber-dot green" />
        </span>
        知識庫健檢
      </summary>
      <p className="kn-note">
        語意層對資料庫的覆蓋率。孤島表（沒有任何關係邊的表）與疑似外鍵缺口，
        是 AI 猜錯 JOIN 的主因——優先到「關係」分頁補上。
      </p>

      {busy && !stats && <div className="kn-empty">統計中…</div>}
      {error && <div className="unreviewed-banner">{error}</div>}

      {stats && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">
                {stats.catalog.described}/{stats.catalog.total}
              </div>
              <div className="stat-label">
                表有描述（校對 {stats.catalog.reviewed}、排除 {stats.catalog.excluded}）
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.relationships.total}</div>
              <div className="stat-label">
                關係邊（校對 {stats.relationships.reviewed}）
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {stats.relationships.tablesWithEdges}/{activeTotal}
              </div>
              <div className="stat-label">表已接上關係圖</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.graph.componentCount}</div>
              <div className="stat-label">
                連通區塊（最大 {stats.graph.largestComponent} 表）
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{stats.graph.isolatedTables.length}</div>
              <div className="stat-label">孤島表</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {stats.analyticsAvailable ? stats.fkGaps.length : "—"}
              </div>
              <div className="stat-label">疑似外鍵缺口</div>
            </div>
          </div>

          <p className="kn-note">
            規則：
            {stats.rules
              .map((r) => `${SCOPE_LABEL[r.scope] ?? r.scope} ${r.total}（校對 ${r.reviewed}）`)
              .join("、")}
            {stats.recentFailures &&
              `　·　近 7 日查詢失敗 ${stats.recentFailures.total} 次` +
                (stats.recentFailures.total > 0
                  ? `（${stats.recentFailures.byStage
                      .map((s) => `${STAGE_LABEL[s.stage] ?? s.stage} ${s.count}`)
                      .join("、")}）`
                  : "") +
                `、自我修復 ${stats.recentFailures.repairs} 次`}
          </p>

          {!stats.analyticsAvailable && (
            <div className="unreviewed-banner">
              分析資料庫連不上——欄位缺口清單暫時無法計算（其餘統計仍正確）。
            </div>
          )}

          {stats.graph.isolatedTables.length > 0 && (
            <details className="stats-sublist">
              <summary>
                孤島表 {stats.graph.isolatedTables.length} 張（無任何關係邊，跨表問題到不了它們）
              </summary>
              <ul>
                {stats.graph.isolatedTables.slice(0, 30).map((t) => (
                  <li key={t}>{t}</li>
                ))}
                {stats.graph.isolatedTables.length > 30 && (
                  <li>… 其餘 {stats.graph.isolatedTables.length - 30} 張</li>
                )}
              </ul>
            </details>
          )}

          {stats.fkGaps.length > 0 && (
            <details className="stats-sublist">
              <summary>
                疑似外鍵缺口 {stats.fkGaps.length} 個（欄名像外鍵、但沒有對應關係邊）
              </summary>
              <ul>
                {stats.fkGaps.slice(0, 30).map((g) => (
                  <li key={`${g.table}.${g.column}`}>
                    {g.table}.<b>{g.column}</b>（{g.dataType}）
                  </li>
                ))}
                {stats.fkGaps.length > 30 && <li>… 其餘 {stats.fkGaps.length - 30} 個</li>}
              </ul>
            </details>
          )}
        </>
      )}
    </details>
  );
}
