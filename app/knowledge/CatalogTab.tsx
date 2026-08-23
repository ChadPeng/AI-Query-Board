"use client";

import { useState } from "react";
import type { CatalogEntry } from "@/lib/state/catalog";

async function patch(body: unknown): Promise<string | null> {
  const res = await fetch("/api/knowledge/tables", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const d = await res.json().catch(() => ({}));
  return d.error ?? "操作失敗";
}

function CatalogRow({ entry, onChanged }: { entry: CatalogEntry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(entry.description);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(reviewed: boolean) {
    setBusy(true); setErr(null);
    const e = await patch({ schema: entry.schema, table: entry.table, description, reviewed, excluded: entry.excluded });
    setBusy(false);
    if (e) { setErr(e); return; }
    setEditing(false);
    onChanged();
  }

  async function toggleExcluded() {
    setBusy(true); setErr(null);
    const e = await patch({
      schema: entry.schema,
      table: entry.table,
      description: entry.description,
      reviewed: entry.reviewed,
      excluded: !entry.excluded,
    });
    setBusy(false);
    if (e) { setErr(e); return; }
    onChanged();
  }

  return (
    <div className={`kn-row ${entry.reviewed ? "" : "unreviewed"} ${entry.excluded ? "excluded" : ""}`}>
      <div className="kn-main">
        <div className="kn-line">
          <code>{entry.schema}.{entry.table}</code>
          <span className={`status-chip ${entry.reviewed ? "reviewed" : "unreviewed"}`}>
            {entry.reviewed ? "已確認" : "未確認"}
          </span>
          {entry.excluded && <span className="status-chip excluded">已排除</span>}
        </div>
        {editing ? (
          <textarea className="kn-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        ) : (
          <div>{entry.description}</div>
        )}
        {err && <div className="auth-error">{err}</div>}
      </div>
      <div className="kn-actions">
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>儲存</button>
            <button className="btn" disabled={busy} onClick={() => { setEditing(false); setDescription(entry.description); }}>取消</button>
          </>
        ) : (
          <>
            {!entry.reviewed && !entry.excluded && (
              <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>確認</button>
            )}
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>編輯</button>
            <button className="btn" disabled={busy} onClick={toggleExcluded}>
              {entry.excluded ? "取消排除" : "排除"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type StatusFilter = "all" | "unreviewed" | "reviewed" | "excluded";

export function CatalogTab({ catalog, onChanged }: { catalog: CatalogEntry[]; onChanged: () => void }) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);

  const q = search.trim().toLowerCase();
  const matches = (c: CatalogEntry) =>
    !q || `${c.schema}.${c.table}`.toLowerCase().includes(q) || (c.description ?? "").toLowerCase().includes(q);

  const searched = catalog.filter(matches);
  const counts = {
    all: searched.length,
    unreviewed: searched.filter((c) => !c.reviewed && !c.excluded).length,
    reviewed: searched.filter((c) => c.reviewed && !c.excluded).length,
    excluded: searched.filter((c) => c.excluded).length,
  };
  const byFilter = (c: CatalogEntry) =>
    filter === "all"
      ? true
      : filter === "excluded"
        ? c.excluded
        : filter === "unreviewed"
          ? !c.reviewed && !c.excluded
          : c.reviewed && !c.excluded;
  // 未確認排前面，校對佇列一眼可見
  const filtered = searched.filter(byFilter);
  const visible = [...filtered.filter((c) => !c.reviewed && !c.excluded), ...filtered.filter((c) => c.reviewed || c.excluded)];

  // 批次確認目前搜尋範圍內、未排除的未確認表（分批送出，附進度）
  async function confirmAll() {
    const targets = searched.filter((c) => !c.reviewed && !c.excluded);
    if (targets.length === 0) return;
    const scopeNote = q ? `搜尋「${search.trim()}」範圍內` : "";
    if (!confirm(`把${scopeNote} ${targets.length} 張未確認的表全部標為已確認？（描述仍可之後再編輯）`)) return;
    setBulkBusy(true);
    let done = 0;
    let failed = 0;
    const queue = [...targets];
    while (queue.length > 0) {
      const batch = queue.splice(0, 8);
      const results = await Promise.all(
        batch.map((c) =>
          patch({ schema: c.schema, table: c.table, description: c.description, reviewed: true, excluded: c.excluded }),
        ),
      );
      done += batch.length;
      failed += results.filter((e) => e !== null).length;
      setBulkProgress(`確認中… ${done}/${targets.length}`);
    }
    setBulkBusy(false);
    setBulkProgress(failed > 0 ? `完成，但有 ${failed} 張失敗` : null);
    onChanged();
  }

  const pendingCount = searched.filter((c) => !c.reviewed && !c.excluded).length;

  return (
    <div>
      {catalog.length === 0 && (
        <div className="kn-empty">表目錄是空的。先跑 <code>npm run bootstrap:catalog</code> 產生每張表的描述。</div>
      )}

      {catalog.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <div className="list-search" style={{ margin: 0, minWidth: 240 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
              <circle cx="7" cy="7" r="5" stroke="var(--text-dim)" strokeWidth="1.5" />
              <path d="M11 11L14 14" stroke="var(--text-dim)" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋表名或描述…" />
          </div>
          <div className="seg-control">
            <button type="button" className={`seg ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}>
              全部 {counts.all}
            </button>
            <button type="button" className={`seg ${filter === "unreviewed" ? "active" : ""}`} onClick={() => setFilter("unreviewed")}>
              待確認 {counts.unreviewed}
            </button>
            <button type="button" className={`seg ${filter === "reviewed" ? "active" : ""}`} onClick={() => setFilter("reviewed")}>
              已確認 {counts.reviewed}
            </button>
            <button type="button" className={`seg ${filter === "excluded" ? "active" : ""}`} onClick={() => setFilter("excluded")}>
              已排除 {counts.excluded}
            </button>
          </div>
          <div style={{ flex: 1 }} />
          {pendingCount > 0 && (
            <button type="button" className="btn" disabled={bulkBusy} onClick={confirmAll}>
              {bulkBusy ? bulkProgress ?? "確認中…" : `全部確認（${pendingCount}）`}
            </button>
          )}
        </div>
      )}

      {!bulkBusy && bulkProgress && <div className="unreviewed-banner">{bulkProgress}</div>}

      {catalog.length > 0 && visible.length === 0 && (
        <div className="kn-empty">
          {q ? `沒有符合「${search.trim()}」的表` : filter === "unreviewed" ? "沒有待確認的表——都校對完了。" : "此篩選下沒有項目。"}
        </div>
      )}

      <div className="kn-list">
        {visible.map((c) => (
          <CatalogRow key={`${c.schema}.${c.table}`} entry={c} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
