"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

type Source = "db" | "env" | "default";

interface SettingRow {
  def: { key: string; label: string; description: string; type: string; secret?: boolean };
  value: unknown;
  source: Source;
  dbValue: string | null;
}

const SOURCE_LABEL: Record<Source, string> = {
  db: "DB 覆寫",
  env: ".env 預設",
  default: "內建預設",
};

export default function AdminSettingsPage() {
  const [settings, setSettings] = useState<SettingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "載入失敗");
        return;
      }
      const d = await res.json();
      const rows: SettingRow[] = d.settings ?? [];
      setSettings(rows);
      setDrafts(Object.fromEntries(rows.map((r) => [r.def.key, r.dbValue ?? ""])));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(key: string, value: string | null) {
    setSavingKey(key);
    setError(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "儲存失敗");
        return;
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <main className="knowledge">
      <div className="kn-top">
        <h1 className="cyber-glitch" data-text="系統設定">
          系統設定
        </h1>
        <span className="header-actions">
          <Link href="/" className="link-btn">
            ← 回儀表板
          </Link>
        </span>
      </div>
      <p className="kn-sub">
        調整營運參數，變更即時生效、免重啟。留空並「還原」表示改用 .env 或內建預設值。
        （祕密設定與連線的搬遷在後續切片處理。）
      </p>

      {error && <div className="unreviewed-banner">{error}</div>}
      {!settings && !error && <div className="kn-empty">載入中…</div>}

      {settings && (
        <div className="settings-list">
          {settings.map((s) => (
            <div key={s.def.key} className="setting-item">
              <div className="setting-head">
                <strong>{s.def.label}</strong>
                <span className="count">
                  目前值：{String(s.value)}（來源：{SOURCE_LABEL[s.source]}）
                </span>
              </div>
              <div className="setting-desc">{s.def.description}</div>
              <div className="param-row">
                <input
                  className="kn-input"
                  value={drafts[s.def.key] ?? ""}
                  placeholder="（未覆寫）"
                  onChange={(e) => setDrafts({ ...drafts, [s.def.key]: e.target.value })}
                />
                <button
                  type="button"
                  className="logout"
                  disabled={savingKey === s.def.key}
                  onClick={() => patch(s.def.key, drafts[s.def.key] ?? "")}
                >
                  儲存
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={savingKey === s.def.key || s.source !== "db"}
                  onClick={() => patch(s.def.key, null)}
                >
                  還原預設
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
