"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { CatalogEntry } from "@/lib/state/catalog";
import type { SemanticRule } from "@/lib/state/semanticRules";
import type { Relationship } from "@/lib/state/relationships";
import { CatalogTab } from "./CatalogTab";
import { RulesTab } from "./RulesTab";
import { RelationshipsTab } from "./RelationshipsTab";
import { LearnFromSqlPanel } from "./LearnFromSqlPanel";

type Tab = "tables" | "relationships" | "rules";

interface KnowledgeData {
  catalog: CatalogEntry[];
  rules: SemanticRule[];
  relationships: Relationship[];
  tables: string[];
}

export default function KnowledgePage() {
  const [tab, setTab] = useState<Tab>("rules");
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
    <main className="knowledge">
      <div className="kn-top">
        <h1 className="cyber-glitch" data-text="語意層">
          語意層
        </h1>
        <span className="header-actions">
          <Link href="/" className="link-btn">
            ← 回儀表板
          </Link>
        </span>
      </div>
      <p className="kn-sub">
        教 AI 如何正確查詢你的資料庫——代碼含義、指標定義、表關係。這些知識全域共用。
        黃底的是 AI 建議、尚未經人工確認的草稿。
      </p>

      {error && <div className="unreviewed-banner">{error}</div>}

      <LearnFromSqlPanel onLearned={load} />

      <div className="tabs">
        <button
          className={`tab ${tab === "tables" ? "active" : ""}`}
          onClick={() => setTab("tables")}
        >
          資料表<span className="count">{unreviewed.tables ? `${unreviewed.tables} 待確認` : ""}</span>
        </button>
        <button
          className={`tab ${tab === "relationships" ? "active" : ""}`}
          onClick={() => setTab("relationships")}
        >
          關係<span className="count">{unreviewed.relationships ? `${unreviewed.relationships} 待確認` : ""}</span>
        </button>
        <button
          className={`tab ${tab === "rules" ? "active" : ""}`}
          onClick={() => setTab("rules")}
        >
          規則<span className="count">{unreviewed.rules ? `${unreviewed.rules} 待確認` : ""}</span>
        </button>
      </div>

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
    </main>
  );
}
