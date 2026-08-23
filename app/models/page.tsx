"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/Sidebar";
import type {
  DatasetFieldDef,
  DatasetMeta,
  DatasetTableNode,
  MeasureAggregation,
} from "@/lib/datasets/types";
import type { Relationship } from "@/lib/state/relationships";

/**
 * 資料模型建構器（BI 第三波，docs/adr/0006）。Editor 把「表怎麼 JOIN、什麼是
 * 維度/度量」固化成具名模型：探索頁在模型上零 LLM 出圖，AI 查詢命中模型時
 * 直接沿用其 JOIN 樹。星型限制：一張基底表、JOIN 只走 多對一/一對一 向維度方向。
 */

interface ColumnMeta {
  column: string;
  dataType: string;
  columnKey: string;
}

interface Draft {
  name: string;
  description: string;
  published: boolean;
  tables: DatasetTableNode[];
  fields: DatasetFieldDef[];
}

const EMPTY_DRAFT: Draft = { name: "", description: "", published: false, tables: [], fields: [] };
const AGGS: MeasureAggregation[] = ["sum", "avg", "count", "count_distinct", "min", "max"];
const AGG_LABEL: Record<MeasureAggregation, string> = {
  sum: "加總 SUM",
  avg: "平均 AVG",
  count: "筆數 COUNT",
  count_distinct: "去重筆數 COUNT DISTINCT",
  min: "最小值 MIN",
  max: "最大值 MAX",
};

const qualified = (t: DatasetTableNode) => `${t.schema}.${t.table}`;

function makeAlias(table: string, taken: Set<string>): string {
  const base = table.slice(table.lastIndexOf(".") + 1).replace(/[^A-Za-z0-9_]/g, "_");
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export default function ModelsPage() {
  const [list, setList] = useState<DatasetMeta[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [knownTables, setKnownTables] = useState<string[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [columnsByTable, setColumnsByTable] = useState<Record<string, ColumnMeta[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/datasets");
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "載入失敗");
      return;
    }
    const d = await res.json();
    setList(d.datasets ?? []);
    setCanManage(Boolean(d.canManage));
  }, []);

  useEffect(() => {
    loadList();
    fetch("/api/knowledge")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setKnownTables(d.tables ?? []);
        setRelationships(d.relationships ?? []);
      })
      .catch(() => {});
  }, [loadList]);

  // 模型內的表一變，就補抓它們的欄位清單（挑欄位／JOIN 欄位用）
  const modelTables = useMemo(() => [...new Set(draft.tables.map(qualified))], [draft.tables]);
  useEffect(() => {
    const missing = modelTables.filter((t) => !columnsByTable[t]);
    if (missing.length === 0) return;
    fetch(`/api/knowledge/columns?tables=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.columns) setColumnsByTable((prev) => ({ ...prev, ...d.columns }));
      })
      .catch(() => {});
  }, [modelTables, columnsByTable]);

  const baseNode = draft.tables.find((t) => t.parentAlias === null) ?? null;
  const aliases = useMemo(() => new Set(draft.tables.map((t) => t.alias)), [draft.tables]);

  // 可加入的 JOIN 邊：模型內某節點是邊的「多」端（from），或一對一任一端
  const joinCandidates = useMemo(() => {
    const inModel = new Map(draft.tables.map((t) => [qualified(t), t]));
    const out: {
      key: string;
      label: string;
      parent: DatasetTableNode;
      childTable: string;
      parentColumn: string;
      childColumn: string;
      cardinality: "many_to_one" | "one_to_one";
      relationshipId: number;
    }[] = [];
    for (const r of relationships) {
      const from = `${r.fromSchema}.${r.fromTable}`;
      const to = `${r.toSchema}.${r.toTable}`;
      const fromNode = inModel.get(from);
      const toNode = inModel.get(to);
      if (fromNode) {
        out.push({
          key: `f${r.id}-${fromNode.alias}`,
          label: `${fromNode.alias}.${r.fromColumn} → ${to}.${r.toColumn}（${r.cardinality === "one_to_one" ? "一對一" : "多對一"}${r.reviewed ? "" : "・未確認"}）`,
          parent: fromNode,
          childTable: to,
          parentColumn: r.fromColumn,
          childColumn: r.toColumn,
          cardinality: r.cardinality,
          relationshipId: r.id,
        });
      }
      if (toNode && r.cardinality === "one_to_one") {
        out.push({
          key: `r${r.id}-${toNode.alias}`,
          label: `${toNode.alias}.${r.toColumn} → ${from}.${r.fromColumn}（一對一${r.reviewed ? "" : "・未確認"}）`,
          parent: toNode,
          childTable: from,
          parentColumn: r.toColumn,
          childColumn: r.fromColumn,
          cardinality: "one_to_one",
          relationshipId: r.id,
        });
      }
    }
    return out;
  }, [relationships, draft.tables]);

  function startNew() {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setEditing(true);
    setError(null);
    setMsg(null);
  }

  async function startEdit(id: number) {
    setError(null);
    setMsg(null);
    const res = await fetch(`/api/datasets/${id}`);
    const d = await res.json();
    if (!res.ok) {
      setError(d.error ?? "載入失敗");
      return;
    }
    setEditingId(id);
    setDraft({
      name: d.dataset.name,
      description: d.dataset.description ?? "",
      published: d.dataset.published,
      tables: d.dataset.tables,
      fields: d.dataset.fields,
    });
    setEditing(true);
  }

  function setBase(table: string) {
    if (!table) return;
    const i = table.indexOf(".");
    setDraft((d) => ({
      ...d,
      tables: [
        {
          alias: makeAlias(table, new Set()),
          schema: table.slice(0, i),
          table: table.slice(i + 1),
          parentAlias: null,
          parentColumn: null,
          childColumn: null,
          cardinality: null,
          relationshipId: null,
        },
      ],
      fields: [],
    }));
  }

  function addJoin(key: string) {
    const c = joinCandidates.find((x) => x.key === key);
    if (!c) return;
    const i = c.childTable.indexOf(".");
    setDraft((d) => ({
      ...d,
      tables: [
        ...d.tables,
        {
          alias: makeAlias(c.childTable, aliases),
          schema: c.childTable.slice(0, i),
          table: c.childTable.slice(i + 1),
          parentAlias: c.parent.alias,
          parentColumn: c.parentColumn,
          childColumn: c.childColumn,
          cardinality: c.cardinality,
          relationshipId: c.relationshipId,
        },
      ],
    }));
  }

  function removeNode(alias: string) {
    setDraft((d) => ({
      ...d,
      tables: d.tables.filter((t) => t.alias !== alias && t.parentAlias !== alias),
      fields: d.fields.filter((f) => f.tableAlias !== alias),
    }));
  }

  // --- 欄位新增表單 ---
  const [dimAlias, setDimAlias] = useState("");
  const [dimColumn, setDimColumn] = useState("");
  const [dimName, setDimName] = useState("");
  const [meaAgg, setMeaAgg] = useState<MeasureAggregation>("sum");
  const [meaColumn, setMeaColumn] = useState("");
  const [meaCond, setMeaCond] = useState("");
  const [meaName, setMeaName] = useState("");

  function columnsOf(alias: string): ColumnMeta[] {
    const node = draft.tables.find((t) => t.alias === alias);
    return node ? (columnsByTable[qualified(node)] ?? []) : [];
  }

  function addDimension() {
    if (!dimAlias || !dimColumn) return;
    const meta = columnsOf(dimAlias).find((c) => c.column === dimColumn);
    setDraft((d) => ({
      ...d,
      fields: [
        ...d.fields,
        {
          kind: "dimension",
          name: dimName.trim() || dimColumn,
          description: null,
          tableAlias: dimAlias,
          columnName: dimColumn,
          dataType: meta?.dataType ?? null,
          aggregation: null,
          conditionSql: null,
          sortOrder: d.fields.length,
        },
      ],
    }));
    setDimColumn("");
    setDimName("");
  }

  function addMeasure() {
    if (!baseNode) return;
    if (meaAgg !== "count" && !meaColumn) return;
    const meta = columnsOf(baseNode.alias).find((c) => c.column === meaColumn);
    setDraft((d) => ({
      ...d,
      fields: [
        ...d.fields,
        {
          kind: "measure",
          name: meaName.trim() || `${meaAgg}_${meaColumn || "rows"}`,
          description: null,
          tableAlias: baseNode.alias,
          columnName: meaAgg === "count" && !meaColumn ? null : meaColumn,
          dataType: meta?.dataType ?? null,
          aggregation: meaAgg,
          conditionSql: meaCond.trim() || null,
          sortOrder: d.fields.length,
        },
      ],
    }));
    setMeaColumn("");
    setMeaCond("");
    setMeaName("");
  }

  function removeField(name: string) {
    setDraft((d) => ({ ...d, fields: d.fields.filter((f) => f.name !== name) }));
  }

  async function save() {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const res = await fetch(editingId ? `/api/datasets/${editingId}` : "/api/datasets", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "儲存失敗");
        return;
      }
      setMsg("✓ 已儲存（欄位與 JOIN 已對真實資料庫驗證）");
      if (!editingId && d.id) setEditingId(d.id);
      await loadList();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    if (!confirm("確定刪除這個資料模型？（探索頁與 AI 將不再使用它）")) return;
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === id) setEditing(false);
      await loadList();
    }
  }

  return (
    <AppShell
      active="models"
      title="資料模型"
      subtitle="把「表怎麼 JOIN、什麼是維度/度量」固化成具名模型——星型限制：一張基底表，JOIN 只沿多對一/一對一往維度方向掛"
    >

      {error && <div className="unreviewed-banner">{error}</div>}
      {msg && <div className="badge">{msg}</div>}

      {!editing && (
        <>
          {canManage && (
            <div style={{ marginBottom: 14 }}>
              <button className="btn btn-primary" onClick={startNew}>
                ＋ 新增模型
              </button>
            </div>
          )}
          <div className="kn-list">
            {list.length === 0 && <div className="kn-empty">還沒有資料模型</div>}
            {list.map((d) => (
              <div key={d.id} className="kn-row">
                <b>{d.name}</b>
                <span className={`status-chip ${d.published ? "reviewed" : "unreviewed"}`}>
                  {d.published ? "已發佈" : "草稿"}
                </span>
                <span style={{ flex: 1, opacity: 0.7 }}>{d.description}</span>
                {canManage && (
                  <>
                    <button className="link-btn" onClick={() => startEdit(d.id)}>
                      編輯
                    </button>
                    <button className="link-btn" onClick={() => remove(d.id)}>
                      刪除
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {editing && (
        <>
          <section className="report-editor">
            <h2>① 基本資料</h2>
            <label className="kn-field">
              名稱（AI 匹配模型時看得到，取業務上的名字，如「訂單分析」）
              <input
                className="kn-input"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="kn-field">
              描述（幫助 AI 與使用者判斷這個模型涵蓋什麼問題）
              <input
                className="kn-input"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
            <label className="kn-field" style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={draft.published}
                onChange={(e) => setDraft({ ...draft, published: e.target.checked })}
              />
              發佈（發佈後 Viewer 可在探索頁使用、AI 查詢可匹配）
            </label>
          </section>

          <section className="report-editor">
            <h2>② 表與 JOIN 樹</h2>
            {!baseNode && (
              <label className="kn-field">
                基底表（fact 表，度量都定義在它身上）
                <select className="kn-select" value="" onChange={(e) => setBase(e.target.value)}>
                  <option value="">選擇基底表…</option>
                  {knownTables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {draft.tables.map((t) => (
              <div key={t.alias} className="kn-row">
                <b>{t.alias}</b>
                <span>{qualified(t)}</span>
                {t.parentAlias === null ? (
                  <span className="status-chip reviewed">基底表</span>
                ) : (
                  <span style={{ opacity: 0.8 }}>
                    JOIN ON {t.parentAlias}.{t.parentColumn} = {t.alias}.{t.childColumn}（
                    {t.cardinality === "one_to_one" ? "一對一" : "多對一"}）
                  </span>
                )}
                <span style={{ flex: 1 }} />
                <button className="link-btn" onClick={() => removeNode(t.alias)}>
                  移除
                </button>
              </div>
            ))}
            {baseNode && (
              <label className="kn-field">
                加入 JOIN（從語意層已知的關係邊挑；未確認邊建議先到語意層校對）
                <select className="kn-select" value="" onChange={(e) => addJoin(e.target.value)}>
                  <option value="">選擇要 JOIN 的關係…</option>
                  {joinCandidates.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </section>

          <section className="report-editor">
            <h2>③ 維度與度量</h2>
            <div className="kn-list">
              {draft.fields.map((f) => (
                <div key={f.name} className="kn-row">
                  <span className={`status-chip ${f.kind === "measure" ? "reviewed" : ""}`}>
                    {f.kind === "measure" ? "度量" : "維度"}
                  </span>
                  <b>{f.name}</b>
                  <span style={{ opacity: 0.8 }}>
                    {f.kind === "measure"
                      ? `${(f.aggregation ?? "").toUpperCase()}(${f.columnName ? `${f.tableAlias}.${f.columnName}` : "*"})` +
                        (f.conditionSql ? `，條件：${f.conditionSql}` : "")
                      : `${f.tableAlias}.${f.columnName}`}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button className="link-btn" onClick={() => removeField(f.name)}>
                    移除
                  </button>
                </div>
              ))}
            </div>

            {draft.tables.length > 0 && (
              <>
                <div className="kn-add">
                  <b>＋ 維度</b>
                  <select className="kn-select" value={dimAlias} onChange={(e) => { setDimAlias(e.target.value); setDimColumn(""); }}>
                    <option value="">表…</option>
                    {draft.tables.map((t) => (
                      <option key={t.alias} value={t.alias}>
                        {t.alias}（{qualified(t)}）
                      </option>
                    ))}
                  </select>
                  <select className="kn-select" value={dimColumn} onChange={(e) => setDimColumn(e.target.value)}>
                    <option value="">欄位…</option>
                    {columnsOf(dimAlias).map((c) => (
                      <option key={c.column} value={c.column}>
                        {c.column}（{c.dataType}）
                      </option>
                    ))}
                  </select>
                  <input
                    className="kn-input"
                    placeholder="顯示名（預設＝欄位名）"
                    value={dimName}
                    onChange={(e) => setDimName(e.target.value)}
                  />
                  <button className="btn" onClick={addDimension} disabled={!dimAlias || !dimColumn}>
                    加入
                  </button>
                </div>

                {baseNode && (
                  <div className="kn-add">
                    <b>＋ 度量</b>
                    <select className="kn-select" value={meaAgg} onChange={(e) => setMeaAgg(e.target.value as MeasureAggregation)}>
                      {AGGS.map((a) => (
                        <option key={a} value={a}>
                          {AGG_LABEL[a]}
                        </option>
                      ))}
                    </select>
                    <select className="kn-select" value={meaColumn} onChange={(e) => setMeaColumn(e.target.value)}>
                      <option value="">{meaAgg === "count" ? "（整列 COUNT(*)）" : "欄位…"}</option>
                      {columnsOf(baseNode.alias).map((c) => (
                        <option key={c.column} value={c.column}>
                          {c.column}（{c.dataType}）
                        </option>
                      ))}
                    </select>
                    <input
                      className="kn-input"
                      placeholder={`口徑條件（選填，如 ${baseNode.alias}.status = 4）`}
                      value={meaCond}
                      onChange={(e) => setMeaCond(e.target.value)}
                    />
                    <input
                      className="kn-input"
                      placeholder="顯示名（如「營收」）"
                      value={meaName}
                      onChange={(e) => setMeaName(e.target.value)}
                    />
                    <button className="btn" onClick={addMeasure} disabled={meaAgg !== "count" && !meaColumn}>
                      加入
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          <div className="header-actions">
            <button className="btn btn-primary" onClick={save} disabled={busy || !draft.name || draft.tables.length === 0}>
              {busy ? "儲存中…（正在對真實資料庫驗證欄位與 JOIN）" : "儲存"}
            </button>
            <button className="logout" onClick={() => setEditing(false)}>
              返回清單
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}
