"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import GridLayout, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { Chart } from "./components/Chart";
import { Sidebar } from "./components/Sidebar";
import { can, isRole } from "@/lib/auth/permissions";
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

/** 空對話時的建議問題：降低「不知道能問什麼」的門檻。 */
const SUGGESTIONS = [
  "近六個月每月營收",
  "各產品類別的總營收",
  "本月各會員等級的客單價",
];

export default function Home() {
  const { data: session } = useSession();
  const canAuthor = can(isRole(session?.user?.role) ? session.user.role : "viewer", "report:create");
  const [promoting, setPromoting] = useState(false);
  const [promoteMsg, setPromoteMsg] = useState<string | null>(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinned, setPinned] = useState<PinnedChart[]>([]);
  const [stashed, setStashed] = useState<PinnedChart[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLong, setBusyLong] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // After ~12s of thinking the engine is likely in a self-repair round — say so
  // instead of leaving a bare "thinking…" (no streaming; this is purely timed).
  useEffect(() => {
    if (!busy) {
      setBusyLong(false);
      return;
    }
    const t = setTimeout(() => setBusyLong(true), 12000);
    return () => clearTimeout(t);
  }, [busy]);

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

    fetch("/api/setup/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && (!d.analyticsConfigured || !d.providerConfigured)) setSetupNeeded(true);
      })
      .catch(() => {});
  }, []);

  function newConversation() {
    setConversationId(null);
    setMessages([]);
    setPreview(null);
  }

  async function ask(question: string) {
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
        setPromoteMsg(null); // clear any stale promote notice from a prior result
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
              ? "已重用你驗證過的查詢，結果如左側預覽。"
              : data.explanation +
                (data.datasetUsed ? `（資料模型：${data.datasetUsed}）` : "") +
                (data.repaired > 0 ? `（已自動修正 ${data.repaired} 次）` : ""),
          },
          ...(data.warnings ?? []).map(
            (w): Message => ({ role: "bot", text: `提示：${w}` }),
          ),
        ]);
      } else {
        setMessages((m) => [
          ...m,
          { role: "bot", text: `查詢失敗：${data.error}${data.sql ? `\n\nSQL:\n${data.sql}` : ""}` },
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

  async function send(e: React.FormEvent) {
    e.preventDefault();
    await ask(input.trim());
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

  // Promote the current AI result into a reusable Report (Editor+). Copies its SQL
  // + chart spec; the new report can then be given parameters on the reports page.
  // A table-type AI result becomes a table-only report (report charts are bar/line/
  // area/pie only).
  async function promote() {
    if (!preview) return;
    setPromoting(true);
    setPromoteMsg(null);
    const isTable = preview.spec.chart_type === "table";
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: (preview.question || preview.spec.title || "未命名報表").slice(0, 255),
          querySql: preview.sql,
          params: [],
          chartSpec: isTable ? null : preview.spec,
          outputMode: isTable ? "table" : "both",
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPromoteMsg(`升格失敗：${d.error ?? "未知錯誤"}`);
        return;
      }
      setPromoteMsg("已升格為報表，可到「報表」頁加參數");
    } catch (e) {
      setPromoteMsg(`升格失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPromoting(false);
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
    <main className="shell">
      <Sidebar active="dashboard" />

      {/* 中央：累積的儀表板 */}
      <section className="charts">
        <div className="charts-head">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0 }}>
            <h1>儀表板</h1>
            <span className="page-hint">拖曳卡片標題列可重新排列</span>
          </div>
        </div>

        <div className="charts-body">
          {setupNeeded && (
            <div className="unreviewed-banner">
              系統尚未設定完成（分析庫或 LLM）。
              {session?.user?.role === "super_admin" ? (
                <Link href="/admin/setup" className="link-btn">
                  前往初始設定 →
                </Link>
              ) : (
                " 請聯絡管理員完成設定。"
              )}
            </div>
          )}

          {preview && (
            <div className="chart-card preview" style={{ marginBottom: 16 }}>
              <div className="card-bar">
                <span className="badge" style={{ color: "var(--accent)" }}>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z" fill="currentColor" />
                  </svg>
                  最新結果・未釘選
                </span>
                <span className="header-actions">
                  {canAuthor && (
                    <button type="button" className="pin ghost" onClick={promote} disabled={promoting}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M8 13V3M8 3L4 7M8 3L12 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {promoting ? "升格中…" : "升格為報表"}
                    </button>
                  )}
                  <button type="button" className="pin" onClick={pin}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M9.5 2L14 6.5L11 7.5L8.5 12.5L7 11L3.5 14.5L1.5 12.5L5 9L3.5 7.5L8.5 5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                    </svg>
                    釘選到儀表板
                  </button>
                </span>
              </div>
              {promoteMsg && <div className="badge">{promoteMsg}</div>}
              <Chart spec={preview.spec} columns={preview.columns} rows={preview.rows} />
              <details className="sql">
                <summary>檢視 SQL</summary>
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
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                        <path d="M9.5 2L14 6.5L11 7.5L8.5 12.5L7 11L3.5 14.5L1.5 12.5L5 9L3.5 7.5L8.5 5L9.5 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                        <line x1="2.5" y1="2.5" x2="13.5" y2="13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
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
                        重新釘選
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="刪除"
                        onClick={() => del(c.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                          <path d="M2.5 4H13.5M6.5 2H9.5M4 4L4.8 13.2C4.85 13.65 5.23 14 5.68 14H10.32C10.77 14 11.15 13.65 11.2 13.2L12 4M6.5 7V11M9.5 7V11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </section>

      {/* 右側：AI 對話 */}
      <aside className="chat">
        <div className="chat-header">
          <span className="who">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L9.6 6.4L14.5 8L9.6 9.6L8 14.5L6.4 9.6L1.5 8L6.4 6.4L8 1.5Z" fill="var(--accent)" />
            </svg>
            AI 分析助理
          </span>
          <span className="header-actions">
            <button type="button" className="btn" onClick={newConversation}>
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              新對話
            </button>
          </span>
        </div>
        <div className="chat-log">
          {messages.length === 0 && (
            <>
              <div className="msg bot">
                用自然語言問一個數據問題，我會生成唯讀 SQL 查詢並畫成圖表。你可以先試試：
              </div>
              <div className="chip-list">
                {SUGGESTIONS.map((q) => (
                  <button key={q} type="button" className="chip-q" onClick={() => ask(q)} disabled={busy}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M2 13.5V9M6 13.5V5.5M10 13.5V8M14 13.5V2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    </svg>
                    <span>{q}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.role}`}>
              {m.text}
            </div>
          ))}
          {busy && (
            <div className="msg bot">
              {busyLong ? "還在思考，可能正在自我修正 SQL…" : "正在分析你的問題…"}
            </div>
          )}
        </div>
        <form className="chat-input" onSubmit={send}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="問一個數據問題…"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !input.trim()} title="送出">
            {busy ? (
              "…"
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M14 2L7.5 8.5M14 2L10 14L7.5 8.5M14 2L2 6L7.5 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>
      </aside>
    </main>
  );
}
