"use client";

import { useCallback, useEffect, useState } from "react";
import type { CatalogEntry } from "@/lib/state/catalog";
import type { SemanticRule } from "@/lib/state/semanticRules";
import type { Relationship } from "@/lib/state/relationships";
import { AppShell } from "../components/Sidebar";
import { CatalogTab } from "./CatalogTab";
import { RulesTab } from "./RulesTab";
import { RelationshipsTab } from "./RelationshipsTab";
import { LearnFromSqlPanel } from "./LearnFromSqlPanel";
import { StatsPanel } from "./StatsPanel";

type Tab = "tables" | "relationships" | "rules";

interface KnowledgeData {
  catalog: CatalogEntry[];
  rules: SemanticRule[];
  relationships: Relationship[];
  tables: string[];
}

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("tables");
  const [data, setData] = useState<KnowledgeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/knowledge");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "載入失敗");
        return;
      }
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const unreviewed = data
    ? {
        tables: data.catalog.filter((c) => !c.reviewed).length,
        relationships: data.relationships.filter((r) => !r.reviewed).length,
        rules: data.rules.filter((r) => !r.reviewed).length,
      }
    : { tables: 0, relationships: 0, rules: 0 };

  return (
    <AppShell
      active="knowledge"
      title="語意層"
      subtitle="教 AI 正確查詢你的資料庫——代碼含義、指標定義、表關係，全域共用"
    >
      {error && <div className="unreviewed-banner">{error}</div>}

      <StatsPanel />

      <LearnFromSqlPanel onLearned={load} />

      <div className="tabs">
        <button
          className={`tab ${tab === "tables" ? "active" : ""}`}
          onClick={() => setTab("tables")}
        >
          資料表
          {unreviewed.tables > 0 && <span className="count">{unreviewed.tables} 待確認</span>}
        </button>
        <button
          className={`tab ${tab === "relationships" ? "active" : ""}`}
          onClick={() => setTab("relationships")}
        >
          關係
          {unreviewed.relationships > 0 && (
            <span className="count">{unreviewed.relationships} 待確認</span>
          )}
        </button>
        <button
          className={`tab ${tab === "rules" ? "active" : ""}`}
          onClick={() => setTab("rules")}
        >
          規則
          {unreviewed.rules > 0 && <span className="count">{unreviewed.rules} 待確認</span>}
        </button>
      </div>

      <p className="kn-note" style={{ margin: "0 0 14px" }}>
        標示「未確認」的是 AI 產生、尚未經人工校對的草稿——仍會提供給 AI 使用，但會註明未經確認。
      </p>

      {!data && !error && <div className="kn-empty">載入中…</div>}

      {data && tab === "tables" && (
        <CatalogTab catalog={data.catalog} onChanged={load} />
      )}
      {data && tab === "relationships" && (
        <RelationshipsTab
          relationships={data.relationships}
          tables={data.tables}
          onChanged={load}
        />
      )}
      {data && tab === "rules" && (
        <RulesTab rules={data.rules} tables={data.tables} onChanged={load} />
      )}
    </AppShell>
  );
}
