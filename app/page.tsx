"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Chart } from "./components/Chart";
import { ThemeToggle } from "./components/ThemeToggle";
import type { ChartSpec, EngineResult, PinnedChart } from "@/lib/llm/types";

const Grid = WidthProvider(GridLayout);

type Message = { role: "user" | "bot"; text: string };

type Preview = {
  question: string;
  spec: ChartSpec;
  columns: string[];
  rows: Record<string, unknown>[];
  sql: string;
  explanation: string;
};

export default function Home() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<PinnedChart[]>([]);
  const [stashed, setStashed] = useState<PinnedChart[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the user's persisted dashboard + most recent conversation on mount.
  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => (r.ok ? r.json() : { charts: [], stashed: [] }))
      .then((d) => {
        setPinned(d.charts ?? []);
        setStashed(d.stashed ?? []);
      })
      .catch(() => {});

    fetch("/api/conversation")
      .then((r) => (r.ok ? r.json() : { conversation: null }))
      .then((d) => {
        if (!d.conversation) return;
        setConversationId(d.conversation.id);
        const restored: Message[] = [];
        for (const t of d.conversation.turns ?? []) {
          restored.push({ role: "user", text: t.question });
          restored.push({ role: "bot", text: t.explanation ?? "（已還原）" });
        }
        setMessages(restored);
      })
      .catch(() => {});
  }, []);

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setPreview(null);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || busy) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId }),
      });
      const data: EngineResult & { conversationId?: number | null } =
        await res.json();
      if (data.conversationId) setConversationId(data.conversationId);
      if (data.ok) {
        setPreview({
          question,
          spec: data.chartSpec,
          columns: data.columns,
          rows: data.rows,
          sql: data.sql,
          explanation: data.explanation,
        });
        setMessages((m) => [
          ...m,
          {
            role: "bot",
            text: data.fromSaved
              ? `♻️ 重用了你已驗證過的查詢`
              : data.explanation +
                (data.repaired > 0 ? `（已自動修正 ${data.repaired} 次）` : ""),
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "bot", text: `⚠️ ${data.error}${data.sql ? `\n\nSQL:\n${data.sql}` : ""}` },
        ]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "bot", text: `錯誤：${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function pin() {
    if (!preview) return;
    const res = await fetch("/api/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: preview.spec.title,
        chartSpec: preview.spec,
        columns: preview.columns,
        rows: preview.rows,
        sql: preview.sql,
        question: preview.question,
      }),
    });
    if (res.ok) {
      const { chart } = await res.json();
      setPinned((p) => [...p, chart]);
      setPreview(null);
    }
  }

  // Unpin = take off the board but keep the snapshot in the stash tray.
  async function unpin(id: number) {
    const res = await fetch(`/api/dashboard/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onBoard: false }),
    });
    if (!res.ok) return;
    const chart = pinned.find((c) => c.id === id);
    setPinned((p) => p.filter((c) => c.id !== id));
    if (chart) setStashed((s) => [{ ...chart, onBoard: false }, ...s]);
  }

  async function repin(id: number) {
    const res = await fetch(`/api/dashboard/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onBoard: true }),
    });
    if (!res.ok) return;
    const chart = stashed.find((c) => c.id === id);
    setStashed((s) => s.filter((c) => c.id !== id));
    if (chart) setPinned((p) => [...p, { ...chart, onBoard: true }]);
  }

  async function del(id: number) {
    const res = await fetch(`/api/dashboard/${id}`, { method: "DELETE" });
    if (res.ok) setStashed((s) => s.filter((c) => c.id !== id));
  }

  // Persist a drag/resize (debounced so we don't spam the server mid-gesture).
  function onLayoutChange(layout: Layout[]) {
    setPinned((prev) =>
      prev.map((c) => {
        const l = layout.find((x) => x.i === String(c.id));
        return l ? { ...c, layout: { x: l.x, y: l.y, w: l.w, h: l.h } } : c;
      }),
    );
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/dashboard", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          layout: layout.map((l) => ({ id: Number(l.i), x: l.x, y: l.y, w: l.w, h: l.h })),
        }),
      }).catch(() => {});
    }, 700);
  }

  const gridLayout: Layout[] = pinned.map((c) => ({
    i: String(c.id),
    x: c.layout.x,
    y: c.layout.y,
    w: c.layout.w,
    h: c.layout.h,
    minW: 3,
    minH: 4,
  }));

  return (
    <main className="layout">
      {/* Left: accumulating dashboard */}
      <section className="charts">
        <h1>儀表板</h1>

        {preview && (
          <div className="chart-card preview">
            <div className="card-bar">
              <span className="badge">最新結果（未釘選）</span>
              <button type="button" className="pin" onClick={pin}>
                📌 釘選到儀表板
              </button>
            </div>
            <Chart spec={preview.spec} columns={preview.columns} rows={preview.rows} />
            <details className="sql">
              <summary>生成的 SQL</summary>
              <pre>{preview.sql}</pre>
            </details>
          </div>
        )}

        {pinned.length === 0 && !preview && (
          <div className="empty">尚無圖表 — 在右側提問，再把結果釘選到這裡</div>
        )}

        {pinned.length > 0 && (
          <Grid
            className="dashboard-rgl"
            layout={gridLayout}
            cols={12}
            rowHeight={40}
            margin={[16, 16]}
            draggableHandle=".card-bar"
            draggableCancel="button"
            onLayoutChange={onLayoutChange}
          >
            {pinned.map((c) => (
              <div key={String(c.id)} className="chart-card">
                <div className="card-bar">
                  <span className="card-title">{c.title}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => unpin(c.id)}
                    title="取消釘選（移到收藏區保留）"
                  >
                    取消釘選
                  </button>
                </div>
                <Chart spec={c.chartSpec} columns={c.columns} rows={c.rows} />
              </div>
            ))}
          </Grid>
        )}

        {stashed.length > 0 && (
          <details className="stash" open>
            <summary>收藏區（{stashed.length}）— 已保留、未上板</summary>
            <div className="stash-list">
              {stashed.map((c) => (
                <div key={c.id} className="stash-item">
                  <span className="stash-title">{c.title}</span>
                  <span className="stash-actions">
                    <button type="button" className="btn" onClick={() => repin(c.id)}>
                      📌 重新釘選
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => del(c.id)}>
                      🗑 刪除
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      {/* Right: AI chat */}
      <aside className="chat">
        <div className="chat-header">
          <span className="who">{session?.user?.email ?? ""}</span>
          <span className="header-actions">
            <Link href="/knowledge" className="link-btn">
              語意層
            </Link>
            <button type="button" className="logout" onClick={newConversation}>
              新對話
            </button>
            <button
              type="button"
              className="logout"
              onClick={() => signOut({ callbackUrl: "/login" })}
            >
              登出
            </button>
            <ThemeToggle />
          </span>
        </div>
        <div className="chat-log">
          {messages.length === 0 && (
            <div className="msg bot">嗨,問我一個數據問題吧,例如「各產品類別的總營收」。</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && <div className="msg bot">思考中…</div>}
        </div>
        <form className="chat-input" onSubmit={send}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="問一個數據問題…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()}>
            {busy ? "…" : "送出"}
          </button>
        </form>
      </aside>
    </main>
  );
}
