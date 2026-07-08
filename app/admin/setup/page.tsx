"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// First-run setup wizard (docs/adr/0005). A guided, focused form over the same
// settings API for the connection + LLM provider that a fresh install must fill
// before the app is usable. Super-admin only (middleware gates /admin).

const ANALYTICS_FIELDS = [
  { key: "analytics.host", label: "分析庫主機", placeholder: "10.0.0.5" },
  { key: "analytics.port", label: "連接埠", placeholder: "3306" },
  { key: "analytics.user", label: "帳號（建議 SELECT-only）", placeholder: "readonly" },
  { key: "analytics.password", label: "密碼（加密存放）", placeholder: "••••••", secret: true },
  { key: "analytics.database", label: "預設資料庫（可空）", placeholder: "mepay" },
  { key: "analytics.schemas", label: "納入的 Schema（逗號分隔）", placeholder: "mepay,hivebee" },
];

const PROVIDERS = ["claude", "gemini", "groq", "ollama", "openai-compat"];
// which key/model fields matter per provider
const PROVIDER_FIELDS: Record<string, { key: string; label: string; secret?: boolean }[]> = {
  claude: [
    { key: "llm.anthropic_key", label: "Anthropic 金鑰", secret: true },
    { key: "llm.anthropic_model", label: "模型" },
  ],
  gemini: [
    { key: "llm.gemini_key", label: "Gemini 金鑰", secret: true },
    { key: "llm.gemini_model", label: "模型" },
  ],
  groq: [
    { key: "llm.groq_key", label: "Groq 金鑰", secret: true },
    { key: "llm.groq_model", label: "模型" },
  ],
  ollama: [
    { key: "llm.ollama_base_url", label: "Base URL" },
    { key: "llm.ollama_model", label: "模型" },
  ],
  "openai-compat": [
    { key: "llm.openai_base_url", label: "Base URL" },
    { key: "llm.openai_key", label: "金鑰", secret: true },
    { key: "llm.openai_model", label: "模型" },
  ],
};

interface Row {
  def: { key: string; secret?: boolean };
  value: unknown;
  source: string;
  dbValue: string | null;
}

export default function SetupWizardPage() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [provider, setProvider] = useState("claude");
  const [status, setStatus] = useState<{ analyticsConfigured: boolean; providerConfigured: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [sres, stres] = await Promise.all([
      fetch("/api/admin/settings"),
      fetch("/api/setup/status"),
    ]);
    if (sres.ok) {
      const d = await sres.json();
      const rows: Row[] = d.settings ?? [];
      const map: Record<string, string> = {};
      for (const r of rows) {
        // prefill non-secrets with their current resolved value; secrets stay blank
        if (!r.def.secret) map[r.def.key] = r.dbValue ?? String(r.value ?? "");
      }
      setDrafts(map);
      const p = rows.find((r) => r.def.key === "llm.provider");
      if (p) setProvider(String(p.value || "claude"));
    }
    if (stres.ok) setStatus(await stres.json());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(key: string, value: string) {
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error ?? `儲存 ${key} 失敗`);
    }
  }

  async function saveAll() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      // provider first, then the fields that are non-empty in the form
      await patch("llm.provider", provider);
      const keys = [...ANALYTICS_FIELDS, ...(PROVIDER_FIELDS[provider] ?? [])];
      for (const f of keys) {
        const v = drafts[f.key];
        // skip blank secrets so we don't overwrite an existing stored secret with ""
        if (v == null) continue;
        if (f.secret && v === "") continue;
        await patch(f.key, v);
      }
      setMsg("✓ 已儲存，設定即時生效");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (f: { key: string; label: string; placeholder?: string; secret?: boolean }) => (
    <label key={f.key} className="kn-field">
      {f.label}
      <input
        className="kn-input"
        type={f.secret ? "password" : "text"}
        placeholder={f.secret ? "（留空＝不變更）" : f.placeholder}
        value={drafts[f.key] ?? ""}
        onChange={(e) => setDrafts({ ...drafts, [f.key]: e.target.value })}
      />
    </label>
  );

  return (
    <main className="knowledge">
      <div className="kn-top">
        <h1 className="cyber-glitch" data-text="初始設定">
          初始設定
        </h1>
        <span className="header-actions">
          <Link href="/admin/settings" className="link-btn">
            進階設定
          </Link>
          <Link href="/" className="link-btn">
            ← 回儀表板
          </Link>
        </span>
      </div>
      <p className="kn-sub">
        填入分析資料庫連線與 LLM 供應商金鑰，系統即可使用。祕密欄位加密存放、不回顯；變更即時生效，免重啟。
      </p>

      {status && (
        <div className={status.analyticsConfigured && status.providerConfigured ? "badge" : "unreviewed-banner"}>
          分析庫：{status.analyticsConfigured ? "已設定 ✓" : "未設定"}　·
          LLM：{status.providerConfigured ? "已設定 ✓" : "未設定"}
        </div>
      )}
      {error && <div className="unreviewed-banner">{error}</div>}
      {msg && <div className="badge">{msg}</div>}

      <section className="report-editor">
        <h2>① 分析資料庫（唯讀）</h2>
        {ANALYTICS_FIELDS.map(field)}
      </section>

      <section className="report-editor">
        <h2>② LLM 供應商</h2>
        <label className="kn-field">
          供應商
          <select className="kn-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        {(PROVIDER_FIELDS[provider] ?? []).map(field)}
      </section>

      <div className="header-actions">
        <button type="button" className="logout" onClick={saveAll} disabled={busy}>
          {busy ? "儲存中…" : "儲存全部"}
        </button>
      </div>
    </main>
  );
}
