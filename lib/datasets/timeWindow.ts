import type { DatasetModel, ExplorerQuery } from "./types";
import { TEMPORAL_TYPES } from "./types";

/** 時間區間上限（天）。含閏年緩衝，實際語意是「最長一年」。 */
export const MAX_WINDOW_DAYS = 366;
/** 預設回看天數（近一年）。 */
export const DEFAULT_WINDOW_DAYS = 365;

const DAY_MS = 86_400_000;

function parseDay(v: unknown): number | null {
  const s = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * 時間治理（docs：以時間窗取代筆數上限作為主要成本護欄）：
 * 模型有時間維度時，探索查詢必須帶一段 ≤ 一年的時間區間。
 * - 已有合法區間（between、日期可解析、跨度 ≤ MAX_WINDOW_DAYS）→ 原樣通過
 * - 跨度超過上限 → 回錯誤字串（呼叫端轉 400）
 * - 完全沒帶 → 在第一個時間維度上注入預設「近一年」（伺服器端保證，
 *   不信任前端；注入後的條件會出現在回傳的 SQL 裡，維持透明）
 * - 模型沒有任何時間維度 → 原樣通過（保底靠編譯器的安全筆數上限）
 */
export function enforceTimeWindow(
  model: DatasetModel,
  q: ExplorerQuery,
  now: Date = new Date(),
): ExplorerQuery | string {
  const temporalDims = model.fields.filter(
    (f) => f.kind === "dimension" && f.dataType != null && TEMPORAL_TYPES.has(f.dataType),
  );
  if (temporalDims.length === 0) return q;

  const temporalIds = new Set(temporalDims.map((f) => f.id));
  for (const f of q.filters) {
    if (f.op !== "between" || !temporalIds.has(f.fieldId)) continue;
    const a = parseDay(f.values[0]);
    const b = parseDay(f.values[1]);
    if (a == null || b == null) continue;
    const span = Math.abs(b - a) / DAY_MS;
    if (span > MAX_WINDOW_DAYS) {
      return `時間區間最長一年（目前約 ${Math.round(span)} 天），請縮小範圍`;
    }
    return q;
  }

  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  return {
    ...q,
    filters: [
      ...q.filters,
      // 尾端補 23:59:59 讓 DATETIME 欄位含當天整天（DATE 欄位比較時同樣成立）
      { fieldId: temporalDims[0].id!, op: "between", values: [start, `${end} 23:59:59`] },
    ],
  };
}
