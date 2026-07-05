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
            {!entry.reviewed && (
              <button className="btn btn-primary" disabled={busy} onClick={() => save(true)}>確認</button>
            )}
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>編輯</button>
            <button className="btn btn-danger" disabled={busy} onClick={toggleExcluded}>
              {entry.excluded ? "取消排除" : "排除"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function CatalogTab({ catalog, onChanged }: { catalog: CatalogEntry[]; onChanged: () => void }) {
  const [hideExcluded, setHideExcluded] = useState(false);
  const excludedCount = catalog.filter((c) => c.excluded).length;
  const visible = hideExcluded ? catalog.filter((c) => !c.excluded) : catalog;

  return (
    <div>
      {catalog.length === 0 && (
        <div className="kn-empty">表目錄是空的。先跑 <code>npm run bootstrap:catalog</code> 產生每張表的描述。</div>
      )}
      {catalog.length > 0 && (
        <label className="kn-filter">
          <input
            type="checkbox"
            checked={hideExcluded}
            onChange={(e) => setHideExcluded(e.target.checked)}
          />
          隱藏已排除的表{excludedCount ? `（${excludedCount} 個已排除）` : ""}
        </label>
      )}
      <div className="kn-list">
        {visible.map((c) => (
          <CatalogRow key={`${c.schema}.${c.table}`} entry={c} onChanged={onChanged} />
        ))}
      </div>
    </div>
  );
}
