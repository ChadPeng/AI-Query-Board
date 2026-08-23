"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error ?? "註冊失敗");
          return;
        }
      }

      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError("帳號或密碼錯誤");
        return;
      }
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 34,
              height: 34,
              borderRadius: 8,
              background: "var(--accent)",
              flexShrink: 0,
            }}
          >
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M2 13.5V9M6 13.5V5.5M10 13.5V8M14 13.5V2.5" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <h1>QueryBoard</h1>
        </div>
        <p className="auth-sub">
          {mode === "login" ? "AI 數據分析平台——登入以繼續" : "建立新帳號"}
        </p>

        {mode === "register" && (
          <label className="auth-field">
            名稱（選填）
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        <label className="auth-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          密碼{mode === "register" && "（至少 8 字元）"}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? (mode === "login" ? "登入中…" : "註冊中…") : mode === "login" ? "登入" : "註冊並登入"}
        </button>

        <button
          type="button"
          className="auth-toggle"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "沒有帳號？建立一個" : "已有帳號？登入"}
        </button>
      </form>
    </main>
  );
}
