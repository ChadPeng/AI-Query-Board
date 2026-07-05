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
      <form className="auth-card cyber-chamfer" onSubmit={submit}>
        <h1 className="cyber-glitch" data-text="AI 數據儀表板">
          AI 數據儀表板
        </h1>
        <p className="auth-sub">{mode === "login" ? "登入以繼續" : "建立新帳號"}</p>

        {mode === "register" && (
          <div className="cyber-input-wrap">
            <span className="cyber-input-prefix">&gt;</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="名稱（選填）"
            />
          </div>
        )}
        <div className="cyber-input-wrap">
          <span className="cyber-input-prefix">&gt;</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            required
          />
        </div>
        <div className="cyber-input-wrap">
          <span className="cyber-input-prefix">&gt;</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密碼（至少 8 字元）"
            required
          />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" disabled={busy}>
          {busy ? "…" : mode === "login" ? "登入" : "註冊並登入"}
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
