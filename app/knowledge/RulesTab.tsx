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
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (!confirm("確定刪除這條規則？AI 之後將不再收到它。")) return;
            run(() => api(`/api/knowledge/rules/${rule.id}`, "DELETE"));
          }}
        >
          刪除
        </button>
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
    <div className="kn-add" style={{ marginTop: 0, marginBottom: 12 }}>
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
  const [filter, setFilter] = useState<"all" | "unreviewed" | "reviewed">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const unreviewed = rules.filter((r) => !r.reviewed);
  const reviewed = rules.filter((r) => r.reviewed);
  const visible =
    filter === "unreviewed" ? unreviewed : filter === "reviewed" ? reviewed : [...unreviewed, ...reviewed];

  async function confirmAll() {
    if (unreviewed.length === 0) return;
    if (!confirm(`把 ${unreviewed.length} 條未確認的規則全部標為已確認？（內容仍可之後再編輯）`)) return;
    setBulkBusy(true);
    setBulkMsg(null);
    let failed = 0;
    const queue = [...unreviewed];
    while (queue.length > 0) {
      const batch = queue.splice(0, 8);
      const results = await Promise.all(
        batch.map((r) =>
          api(`/api/knowledge/rules/${r.id}`, "PATCH", {
            scope: r.scope,
            termName: r.termName ?? "",
            table: r.table ?? "",
            content: r.content,
            reviewed: true,
          }),
        ),
      );
      failed += results.filter((e) => e !== null).length;
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
            全部 {rules.length}
          </button>
          <button type="button" className={`seg ${filter === "unreviewed" ? "active" : ""}`} onClick={() => setFilter("unreviewed")}>
            待確認 {unreviewed.length}
          </button>
          <button type="button" className={`seg ${filter === "reviewed" ? "active" : ""}`} onClick={() => setFilter("reviewed")}>
            已確認 {reviewed.length}
          </button>
        </div>
        <div style={{ flex: 1 }} />
        {unreviewed.length > 0 && (
          <button type="button" className="btn" disabled={bulkBusy} onClick={confirmAll}>
            {bulkBusy ? "確認中…" : `全部確認（${unreviewed.length}）`}
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          新增規則
        </button>
      </div>

      {bulkMsg && <div className="unreviewed-banner">{bulkMsg}</div>}

      {showAdd && <AddRule tables={tables} onChanged={onChanged} />}

      {rules.length === 0 && (
        <div className="kn-empty">
          尚無規則。點右上「新增規則」建立，或先跑 <code>npm run bootstrap:semantics</code> 產生草稿。
        </div>
      )}
      {rules.length > 0 && visible.length === 0 && (
        <div className="kn-empty">{filter === "unreviewed" ? "沒有待確認的規則——都校對完了。" : "此篩選下沒有項目。"}</div>
      )}

      <div className="kn-list">
        {visible.map((r) => (
          <RuleRow key={r.id} rule={r} tables={tables} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
