"use client";

import { useState } from "react";
import type { SemanticRule, RuleScope } from "@/lib/state/semanticRules";

const SCOPE_LABEL: Record<RuleScope, string> = {
  global: "全域",
  term: "術語",
  table: "表級",
};

async function api(url: string, method: string, body?: unknown): Promise<string | null> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d.error ?? "操作失敗";
}

function RuleRow({
  rule,
  tables,
  onChanged,
}: {
  rule: SemanticRule;
  tables: string[];
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [scope, setScope] = useState<RuleScope>(rule.scope);
  const [termName, setTermName] = useState(rule.termName ?? "");
  const [table, setTable] = useState(rule.table ?? tables[0] ?? "");
  const [content, setContent] = useState(rule.content);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run(fn: () => Promise<string | null>) {
    setBusy(true);
    setErr(null);
    const e = await fn();
    setBusy(false);
    if (e) setErr(e);
    else onChanged();
  }

  const payload = (reviewed: boolean) => ({ scope, termName, table, content, reviewed });

  if (editing) {
    return (
      <div className="kn-row">
        <div className="kn-main">
          <div className="kn-line">
            <select className="kn-select" value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
              <option value="global">全域</option>
              <option value="term">術語</option>
              <option value="table">表級</option>
            </select>
            {scope === "term" && (
              <input className="kn-input" placeholder="術語名稱（如 創作者）" value={termName} onChange={(e) => setTermName(e.target.value)} />
            )}
            {scope === "table" && (
              <select className="kn-select" value={table} onChange={(e) => setTable(e.target.value)}>
                {tables.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            )}
          </div>
          <textarea className="kn-textarea" value={content} onChange={(e) => setContent(e.target.value)} />
          {err && <div className="auth-error">{err}</div>}
        </div>
        <div className="kn-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => {
            const e = await api(`/api/knowledge/rules/${rule.id}`, "PATCH", payload(true));
            if (!e) setEditing(false);
            return e;
          })}>儲存</button>
          <button className="btn" disabled={busy} onClick={() => setEditing(false)}>取消</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`kn-row ${rule.reviewed ? "" : "unreviewed"}`}>
      <div className="kn-main">
        <div className="kn-line">
          <span className="scope-chip">{SCOPE_LABEL[rule.scope]}</span>
          {rule.scope === "term" && rule.termName && <strong>「{rule.termName}」</strong>}
          {rule.scope === "table" && rule.table && <code>{rule.table}</code>}
          <span className={`status-chip ${rule.reviewed ? "reviewed" : "unreviewed"}`}>
            {rule.reviewed ? "已確認" : "未確認"}
          </span>
        </div>
        <div>{rule.content}</div>
        {err && <div className="auth-error">{err}</div>}
      </div>
      <div className="kn-actions">
        {!rule.reviewed && (
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api(`/api/knowledge/rules/${rule.id}`, "PATCH", payload(true)))}>確認</button>
        )}
        <button className="btn" disabled={busy} onClick={() => setEditing(true)}>編輯</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => run(() => api(`/api/knowledge/rules/${rule.id}`, "DELETE"))}>刪除</button>
      </div>
    </div>
  );
}

function AddRule({ tables, onChanged }: { tables: string[]; onChanged: () => void }) {
  const [scope, setScope] = useState<RuleScope>("global");
  const [termName, setTermName] = useState("");
  const [table, setTable] = useState(tables[0] ?? "");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setErr(null);
    const e = await api("/api/knowledge/rules", "POST", { scope, termName, table, content, reviewed: true });
    setBusy(false);
    if (e) { setErr(e); return; }
    setContent(""); setTermName("");
    onChanged();
  }

  return (
    <div className="kn-add">
      <h3>新增規則</h3>
      <div className="kn-row-form">
        <select className="kn-select" value={scope} onChange={(e) => setScope(e.target.value as RuleScope)}>
          <option value="global">全域</option>
          <option value="term">術語</option>
          <option value="table">表級</option>
        </select>
        {scope === "term" && (
          <input className="kn-input" placeholder="術語名稱（如 創作者）" value={termName} onChange={(e) => setTermName(e.target.value)} />
        )}
        {scope === "table" && (
          <select className="kn-select" value={table} onChange={(e) => setTable(e.target.value)}>
            {tables.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      <textarea
        className="kn-textarea"
        style={{ marginTop: 8 }}
        placeholder={scope === "term" ? "如：創作者 = user 表中 is_creator=1 的人" : "規則內容…"}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      {err && <div className="auth-error">{err}</div>}
      <div style={{ marginTop: 8 }}>
        <button className="btn btn-primary" disabled={busy || !content.trim()} onClick={add}>新增</button>
      </div>
    </div>
  );
}

export function RulesTab({
  rules,
  tables,
  onChanged,
}: {
  rules: SemanticRule[];
  tables: string[];
  onChanged: () => void;
}) {
  return (
    <div>
      {rules.length === 0 && <div className="kn-empty">尚無規則。用下方表單新增，或先跑 <code>npm run bootstrap:semantics</code> 產生草稿。</div>}
      <div className="kn-list">
        {rules.map((r) => (
          <RuleRow key={r.id} rule={r} tables={tables} onChanged={onChanged} />
        ))}
      </div>
      <AddRule tables={tables} onChanged={onChanged} />
    </div>
  );
}
