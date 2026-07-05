"use client";

import { useState } from "react";

interface Summary {
  relationshipsAdded: number;
  rulesAdded: number;
  relationshipsSkipped: number;
  rulesSkipped: number;
}

/**
 * Paste example SQL → the AI extracts relationship + rule drafts (reviewed=0)
 * into the Semantic Layer. New drafts show up (highlighted) in the tabs below.
 */
export function LearnFromSqlPanel({ onLearned }: { onLearned: () => void }) {
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<Summary | null>(null);

  async function learn() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const res = await fetch("/api/knowledge/learn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const d = await res.json();
      if (!res.ok) {
        setErr(d.error ?? "學習失敗");
        return;
      }
      setResult(d);
      onLearned();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="learn-panel cyber-chamfer"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        <span className="cyber-terminal-dots" aria-hidden="true">
          <span className="cyber-dot red" />
          <span className="cyber-dot yellow" />
          <span className="cyber-dot green" />
        </span>
        從 SQL 學習規則
      </summary>
      <p className="kn-note">
        貼上你平常在用的 SQL，AI 會從 JOIN 抽出表關係、從 WHERE 抽出代碼/過濾/術語規則，全部存成草稿（未確認）等你到下方分頁校對。
      </p>
      <textarea
        className="kn-textarea"
        style={{ minHeight: 120, fontFamily: "ui-monospace, monospace" }}
        placeholder={"SELECT o.*, u.name\nFROM orders o\nJOIN user u ON o.user_id = u.id\nWHERE u.is_creator = 1 AND o.status = 3"}
        value={sql}
        onChange={(e) => setSql(e.target.value)}
      />
      {err && <div className="auth-error">{err}</div>}
      {result && (
        <div className="learn-result">
          ✓ 新增關係草稿 {result.relationshipsAdded} 條、規則草稿 {result.rulesAdded} 條
          {result.relationshipsSkipped + result.rulesSkipped > 0 &&
            `（略過 ${result.relationshipsSkipped + result.rulesSkipped} 條：重複或指向未知表）`}
          。到下方分頁校對黃底項目。
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <button className="btn btn-primary" disabled={busy || !sql.trim()} onClick={learn}>
          {busy ? "學習中…" : "學習"}
        </button>
      </div>
    </details>
  );
}
