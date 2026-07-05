"use client";

import { useState } from "react";
import type { Relationship, Cardinality } from "@/lib/state/relationships";
import { RelationshipGraph } from "./RelationshipGraph";

const CARD_LABEL: Record<Cardinality, string> = {
  many_to_one: "多對一",
  one_to_one: "一對一",
};

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

function toBody(r: {
  fromTable: string; fromColumn: string; toTable: string; toColumn: string;
  cardinality: Cardinality; reviewed: boolean;
}) {
  return r;
}

function RelRow({ rel, tables, onChanged }: { rel: Relationship; tables: string[]; onChanged: () => void }) {
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
            <select className="kn-select" value={fromTable} onChange={(e) => setFromTable(e.target.value)}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="kn-input mono" placeholder="來源欄" value={fromColumn} onChange={(e) => setFromColumn(e.target.value)} style={{ width: 120 }} />
            <span className="arrow">→</span>
            <select className="kn-select" value={toTable} onChange={(e) => setToTable(e.target.value)}>
              {tables.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="kn-input mono" placeholder="目標欄" value={toColumn} onChange={(e) => setToColumn(e.target.value)} style={{ width: 120 }} />
            <select className="kn-select" value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
              <option value="many_to_one">多對一</option>
              <option value="one_to_one">一對一</option>
            </select>
          </div>
          {err && <div className="auth-error">{err}</div>}
        </div>
        <div className="kn-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
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
        <button className="btn btn-danger" disabled={busy} onClick={() => run(() => api(`/api/knowledge/relationships/${rel.id}`, "DELETE"))}>刪除</button>
      </div>
    </div>
  );
}

function AddRel({ tables, onChanged }: { tables: string[]; onChanged: () => void }) {
  const [fromTable, setFromTable] = useState(tables[0] ?? "");
  const [fromColumn, setFromColumn] = useState("");
  const [toTable, setToTable] = useState(tables[0] ?? "");
  const [toColumn, setToColumn] = useState("");
  const [cardinality, setCardinality] = useState<Cardinality>("many_to_one");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function add() {
    setBusy(true); setMsg(null);
    const r = await api("/api/knowledge/relationships", "POST", {
      fromTable, fromColumn, toTable, toColumn, cardinality, reviewed: true,
    });
    setBusy(false);
    if (r.error) { setMsg(r.error); return; }
    setFromColumn(""); setToColumn("");
    if (r.reverseWarning) setMsg(`已新增，但注意：${r.reverseWarning}`);
    onChanged();
  }

  return (
    <div className="kn-add">
      <h3>新增關係</h3>
      <div className="kn-row-form">
        <select className="kn-select" value={fromTable} onChange={(e) => setFromTable(e.target.value)}>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="kn-input mono" placeholder="來源欄（如 user_id）" value={fromColumn} onChange={(e) => setFromColumn(e.target.value)} style={{ width: 150 }} />
        <span className="arrow">→</span>
        <select className="kn-select" value={toTable} onChange={(e) => setToTable(e.target.value)}>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input className="kn-input mono" placeholder="目標欄（如 id）" value={toColumn} onChange={(e) => setToColumn(e.target.value)} style={{ width: 150 }} />
        <select className="kn-select" value={cardinality} onChange={(e) => setCardinality(e.target.value as Cardinality)}>
          <option value="many_to_one">多對一</option>
          <option value="one_to_one">一對一</option>
        </select>
        <button className="btn btn-primary" disabled={busy || !fromColumn.trim() || !toColumn.trim()} onClick={add}>新增</button>
      </div>
      <p className="kn-note">多對多不用建：由多條「多對一」邊經中間表自動走出來。</p>
      {msg && <div className="auth-error">{msg}</div>}
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
  return (
    <div>
      <RelationshipGraph tables={tables} relationships={relationships} />
      {relationships.length === 0 && (
        <div className="kn-empty">尚無關係。用下方表單新增，或跑 <code>npm run bootstrap:semantics</code> 由 <code>xxx_id</code> 欄名自動推斷草稿。</div>
      )}
      <div className="kn-list">
        {relationships.map((r) => (
          <RelRow key={r.id} rel={r} tables={tables} onChanged={onChanged} />
        ))}
      </div>
      <AddRel tables={tables} onChanged={onChanged} />
    </div>
  );
}
