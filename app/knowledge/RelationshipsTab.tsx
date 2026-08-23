"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Relationship, Cardinality } from "@/lib/state/relationships";
import { RelationshipGraph } from "./RelationshipGraph";

const CARD_LABEL: Record<Cardinality, string> = {
  many_to_one: "多對一",
  one_to_one: "一對一",
};

type StatusFilter = "all" | "unreviewed" | "reviewed";

interface ColumnMeta {
  column: string;
  dataType: string;
  columnKey: string;
}
/** table → 欄位清單；undefined＝還沒載、null＝載入失敗（退回手打輸入框）。 */
type ColumnsMap = Record<string, ColumnMeta[] | null>;

async function api(url: string, method: string, body?: unknown): Promise<{ error?: string; reverseWarning?: string | null }> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return { error: d.error ?? "操作失敗" };
  return d;
}

/** 欄位挑選器：表已知就用下拉（免打字、防打錯），欄位載入失敗才退回輸入框。 */
function ColumnPicker({
  table,
  value,
  onChange,
  placeholder,
  columns,
  ensureColumns,
}: {
  table: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  columns: ColumnsMap;
  ensureColumns: (table: string) => void;
}) {
  useEffect(() => {
    if (table) ensureColumns(table);
  }, [table, ensureColumns]);

  const list = columns[table];
  if (list === null) {
    return (
      <input
        className="kn-input mono"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 160 }}
      />
    );
  }
  const known = list ?? [];
  const hasValue = value && known.some((c) => c.column === value);
  return (
    <select className="kn-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={list === undefined}>
      <option value="">{list === undefined ? "載入欄位中…" : placeholder}</option>
      {!hasValue && value && <option value={value}>{value}</option>}
      {known.map((c) => (
        <option key={c.column} value={c.column}>
          {c.column}
        </option>
      ))}
    </select>
  );
}

function toBody(r: {
  fromTable: string; fromColumn: string; toTable: string; toColumn: string;
  cardinality: Cardinality; reviewed: boolean;
}) {
  return r;
}

function RelRow({
  rel,
  tables,
  columns,
  ensureColumns,
  onChanged,
}: {
  rel: Relationship;
  tables: string[];
  columns: ColumnsMap;
  ensureColumns: (table: string) => void;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [fromTable, setFromTable] = useState(`${rel.fromSchema}.${rel.fromTable}`);
  const [fromColumn, setFromColumn] = useState(rel.fromColumn);
  const [toTable, setToTable] = useState(`${rel.toSchema}.${rel.toTable}`);
  const [toColumn, setToColumn] = useState(rel.toColumn);
  const [cardinality, setCardinality] = useState<Cardinality>(rel.cardinality);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<{ error?: string }>) {
    setBusy(true); setErr(null);
    const r = await fn();
    setBusy(false);
    if (r.error) setErr(r.error);
    else onChanged();
  }

  const body = (reviewed: boolean) => toBody({ fromTable, fromColumn, toTable, toColumn, cardinality, reviewed });

  if (editing) {
    return (
      <div className="kn-row">
        <div className="kn-main">
          <div className="kn-line">
            <select className="kn-select" value={fromTable} onChange={(e) => { setFromTable(e.target.value); setFromColumn(""); }}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <ColumnPicker table={fromTable} value={fromColumn} onChange={setFromColumn} placeholder="來源欄…" columns={columns} ensureColumns={ensureColumns} />
            <span className="arrow">→</span>
            <select className="kn-select" value={toTable} onChange={(e) => { setToTable(e.target.value); setToColumn(""); }}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <ColumnPicker table={toTable} value={toColumn} onChange={setToColumn} placeholder="目標欄…" columns={columns} ensureColumns={ensureColumns} />
            <select className="kn-select" value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
              <option value="many_to_one">多對一</option>
              <option value="one_to_one">一對一</option>
            </select>
          </div>
          {err && <div className="auth-error">{err}</div>}
        </div>
        <div className="kn-actions">
          <button className="btn btn-primary" disabled={busy || !fromColumn || !toColumn} onClick={() => run(async () => {
            const r = await api(`/api/knowledge/relationships/${rel.id}`, "PATCH", body(true));
            if (!r.error) setEditing(false);
            return r;
          })}>儲存</button>
          <button className="btn" disabled={busy} onClick={() => setEditing(false)}>取消</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`kn-row ${rel.reviewed ? "" : "unreviewed"}`}>
      <div className="kn-main">
        <div className="kn-line">
          <code>{rel.fromSchema}.{rel.fromTable}.{rel.fromColumn}</code>
          <span className="arrow">→</span>
          <code>{rel.toSchema}.{rel.toTable}.{rel.toColumn}</code>
          <span className="scope-chip">{CARD_LABEL[rel.cardinality]}</span>
          <span className={`status-chip ${rel.reviewed ? "reviewed" : "unreviewed"}`}>
            {rel.reviewed ? "已確認" : "未確認"}
          </span>
        </div>
        {err && <div className="auth-error">{err}</div>}
      </div>
      <div className="kn-actions">
        {!rel.reviewed && (
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/api/knowledge/relationships/${rel.id}`, "PATCH", body(true)))}>確認</button>
        )}
        <button className="btn" disabled={busy} onClick={() => setEditing(true)}>編輯</button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (!confirm(`確定刪除關係 ${rel.fromTable}.${rel.fromColumn} → ${rel.toTable}.${rel.toColumn}？`)) return;
            run(() => api(`/api/knowledge/relationships/${rel.id}`, "DELETE"));
          }}
        >
          刪除
        </button>
      </div>
    </div>
  );
}

function AddRel({
  tables,
  columns,
  ensureColumns,
  onChanged,
}: {
  tables: string[];
  columns: ColumnsMap;
  ensureColumns: (table: string) => void;
  onChanged: () => void;
}) {
  const [fromTable, setFromTable] = useState(tables[0] ?? "");
  const [fromColumn, setFromColumn] = useState("");
  const [toTable, setToTable] = useState(tables[0] ?? "");
  const [toColumn, setToColumn] = useState("");
  const [cardinality, setCardinality] = useState<Cardinality>("many_to_one");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function add() {
    setBusy(true); setErr(null); setWarn(null); setDone(false);
    const r = await api("/api/knowledge/relationships", "POST", {
      fromTable, fromColumn, toTable, toColumn, cardinality, reviewed: true,
    });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setFromColumn(""); setToColumn("");
    setDone(true);
    if (r.reverseWarning) setWarn(r.reverseWarning);
    onChanged();
  }

  return (
    <div className="kn-add" style={{ marginTop: 0, marginBottom: 12 }}>
      <h3>新增關係</h3>
      <div className="kn-row-form">
        <select className="kn-select" value={fromTable} onChange={(e) => { setFromTable(e.target.value); setFromColumn(""); }}>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <ColumnPicker table={fromTable} value={fromColumn} onChange={setFromColumn} placeholder="來源欄（如 user_id）…" columns={columns} ensureColumns={ensureColumns} />
        <span className="arrow">→</span>
        <select className="kn-select" value={toTable} onChange={(e) => { setToTable(e.target.value); setToColumn(""); }}>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <ColumnPicker table={toTable} value={toColumn} onChange={setToColumn} placeholder="目標欄（如 id）…" columns={columns} ensureColumns={ensureColumns} />
        <select className="kn-select" value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
          <option value="many_to_one">多對一</option>
          <option value="one_to_one">一對一</option>
        </select>
        <button className="btn btn-primary" disabled={busy || !fromColumn.trim() || !toColumn.trim()} onClick={add}>新增</button>
      </div>
      <p className="kn-note">多對多不用建：由多條「多對一」邊經中間表自動走出來。</p>
      {done && !warn && <div className="learn-result">已新增關係。</div>}
      {warn && <div className="unreviewed-banner" style={{ marginTop: 8, marginBottom: 0 }}>已新增，但注意：{warn}</div>}
      {err && <div className="auth-error">{err}</div>}
    </div>
  );
}

export function RelationshipsTab({
  relationships,
  tables,
  onChanged,
}: {
  relationships: Relationship[];
  tables: string[];
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [showGraph, setShowGraph] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [columns, setColumns] = useState<ColumnsMap>({});

  // 每張表只抓一次欄位；undefined＝載入中、null＝失敗（Picker 退回輸入框）。
  const requested = useRef<Set<string>>(new Set());
  const ensureColumns = useCallback((table: string) => {
    if (requested.current.has(table)) return;
    requested.current.add(table);
    fetch(`/api/knowledge/columns?tables=${encodeURIComponent(table)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setColumns((p) => ({ ...p, [table]: d?.columns?.[table] ?? null })))
      .catch(() => setColumns((p) => ({ ...p, [table]: null })));
  }, []);

  const unreviewed = relationships.filter((r) => !r.reviewed);
  const reviewed = relationships.filter((r) => r.reviewed);
  const visible =
    filter === "unreviewed" ? unreviewed : filter === "reviewed" ? reviewed : [...unreviewed, ...reviewed];

  async function confirmAll() {
    if (unreviewed.length === 0) return;
    if (!confirm(`把 ${unreviewed.length} 條未確認的關係全部標為已確認？（內容仍可之後再編輯）`)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    let failed = 0;
    const queue = [...unreviewed];
    while (queue.length > 0) {
      const batch = queue.splice(0, 8);
      const results = await Promise.all(
        batch.map((rel) =>
          api(`/api/knowledge/relationships/${rel.id}`, "PATCH", {
            fromTable: `${rel.fromSchema}.${rel.fromTable}`,
            fromColumn: rel.fromColumn,
            toTable: `${rel.toSchema}.${rel.toTable}`,
            toColumn: rel.toColumn,
            cardinality: rel.cardinality,
            reviewed: true,
          }),
        ),
      );
      failed += results.filter((r) => r.error).length;
    }
    setBulkBusy(false);
    setBulkMsg(failed > 0 ? `完成，但有 ${failed} 條失敗` : null);
    onChanged();
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <div className="seg-control">
          <button type="button" className={`seg ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
            全部 {relationships.length}
          </button>
          <button type="button" className={`seg ${filter === "unreviewed" ? "active" : ""}`} onClick={() => setFilter("unreviewed")}>
            待確認 {unreviewed.length}
          </button>
          <button type="button" className={`seg ${filter === "reviewed" ? "active" : ""}`} onClick={() => setFilter("reviewed")}>
            已確認 {reviewed.length}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button type="button" className={`btn ${showGraph ? "btn-secondary" : ""}`} onClick={() => setShowGraph((v) => !v)}>
          {showGraph ? "隱藏關係圖" : "檢視關係圖"}
        </button>
        {unreviewed.length > 0 && (
          <button type="button" className="btn" disabled={bulkBusy} onClick={confirmAll}>
            {bulkBusy ? "確認中…" : `全部確認（${unreviewed.length}）`}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          新增關係
        </button>
      </div>

      {bulkMsg && <div className="unreviewed-banner">{bulkMsg}</div>}

      {showAdd && <AddRel tables={tables} columns={columns} ensureColumns={ensureColumns} onChanged={onChanged} />}

      {showGraph && <RelationshipGraph tables={tables} relationships={relationships} />}

      {relationships.length === 0 && (
        <div className="kn-empty">
          還沒有任何關係。點右上「新增關係」建立，或跑 <code>npm run bootstrap:semantics</code> 由 <code>xxx_id</code> 欄名自動推斷草稿。
        </div>
      )}
      {relationships.length > 0 && visible.length === 0 && (
        <div className="kn-empty">{filter === "unreviewed" ? "沒有待確認的關係——都校對完了。" : "此篩選下沒有項目。"}</div>
      )}

      <div className="kn-list">
        {visible.map((r) => (
          <RelRow key={r.id} rel={r} tables={tables} columns={columns} ensureColumns={ensureColumns} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
