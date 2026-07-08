/**
 * Report Parameters (CONTEXT.md "Report Parameter"). A Report may declare named,
 * typed inputs bound into its SQL at run time. This module is PURE (no DB) and is
 * the security core of the feature: values are only ever emitted as positional
 * `?` placeholders with a separate ordered values array — never concatenated into
 * SQL — so a parameter can't break the read-only guarantee or inject SQL.
 *
 * Placeholder syntax in the Report SQL is `:name`. A `date_range` param named `p`
 * is referenced as two placeholders `:p_start` and `:p_end`; every other type is
 * referenced as `:name`. Dynamic table/column names, `IN (...)` lists, and
 * optional clauses are intentionally out of scope (only value-position binding).
 */

export type ParamType = "date" | "date_range" | "number" | "text" | "enum";

export interface ReportParam {
  /** identifier; placeholder `:name` (date_range → `:name_start` / `:name_end`) */
  name: string;
  type: ParamType;
  /** shown to whoever runs the report */
  label: string;
  /** if blank at run time and no default, binding fails */
  required: boolean;
  /** used when the runner leaves a scalar param blank (not used for date_range) */
  default?: string | null;
  /** the allowed values for an enum param (rendered as a dropdown) */
  options?: string[];
}

/** A date_range value as submitted by the runner. */
export interface DateRangeValue {
  start?: string;
  end?: string;
}

export type BindResult =
  | { ok: true; sql: string; values: unknown[]; applied: Record<string, unknown> }
  | { ok: false; error: string };

const IDENT_START = /[a-zA-Z_]/;
const IDENT_CHAR = /[a-zA-Z0-9_]/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Rewrite `:name` placeholders (outside string literals / comments / backtick
 * identifiers) into positional `?`, pushing the mapped value for each occurrence.
 * A placeholder whose name isn't in `valueMap` is a hard error — this is how an
 * undeclared parameter is caught. Skipping quoted regions means a literal like
 * `'12:00'` or `'a:b'` is never mistaken for a placeholder.
 */
function bindPlaceholders(
  sql: string,
  valueMap: Map<string, unknown>,
): { sql: string; values: unknown[] } | { error: string } {
  let out = "";
  const values: unknown[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const ch = sql[i];

    // String / identifier literals: copy verbatim, respecting escapes.
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      out += ch;
      i++;
      while (i < n) {
        const c = sql[i];
        if (c === "\\" && quote !== "`" && i + 1 < n) {
          out += c + sql[i + 1];
          i += 2;
          continue;
        }
        if (c === quote) {
          if (sql[i + 1] === quote) {
            out += c + quote; // doubled-quote escape
            i += 2;
            continue;
          }
          out += c;
          i++;
          break;
        }
        out += c;
        i++;
      }
      continue;
    }

    // Line comment  -- … \n
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < n && sql[i] !== "\n") {
        out += sql[i];
        i++;
      }
      continue;
    }

    // Block comment  /* … */
    if (ch === "/" && sql[i + 1] === "*") {
      out += "/*";
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) {
        out += sql[i];
        i++;
      }
      if (i < n) {
        out += "*/";
        i += 2;
      }
      continue;
    }

    // Placeholder  :name
    if (ch === ":" && IDENT_START.test(sql[i + 1] ?? "")) {
      let j = i + 1;
      while (j < n && IDENT_CHAR.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!valueMap.has(name)) {
        return { error: `SQL 使用了未宣告的參數 :${name}` };
      }
      out += "?";
      values.push(valueMap.get(name));
      i = j;
      continue;
    }

    out += ch;
    i++;
  }
  return { sql: out, values };
}

/** Resolve one scalar param to its bound value, or return an error message. */
function resolveScalar(p: ReportParam, raw: unknown): { value: string | number } | { error: string } {
  const provided = raw === undefined || raw === null || raw === "" ? undefined : raw;
  const resolved = provided ?? (p.default != null && p.default !== "" ? p.default : undefined);
  if (resolved === undefined) {
    return { error: `請填寫「${p.label}」` };
  }
  switch (p.type) {
    case "date": {
      const s = String(resolved);
      if (!DATE_RE.test(s)) return { error: `「${p.label}」需為 YYYY-MM-DD 日期` };
      return { value: s };
    }
    case "number": {
      const num = Number(resolved);
      if (!Number.isFinite(num)) return { error: `「${p.label}」需為數字` };
      return { value: num };
    }
    case "enum": {
      const s = String(resolved);
      if (!p.options?.includes(s)) return { error: `「${p.label}」不是允許的選項` };
      return { value: s };
    }
    case "text":
      return { value: String(resolved) };
    default:
      return { error: `「${p.label}」型別無效` };
  }
}

/**
 * Bind a Report's SQL template with the runner-supplied values. Returns the
 * positional-parameter SQL + ordered values (ready for a prepared statement), or
 * a user-facing error. `applied` echoes the resolved values for display.
 */
export function bindReportSql(
  sqlTemplate: string,
  params: ReportParam[],
  inputValues: Record<string, unknown>,
): BindResult {
  const valueMap = new Map<string, unknown>();
  const applied: Record<string, unknown> = {};

  for (const p of params) {
    if (p.type === "date_range") {
      const raw = (inputValues[p.name] ?? {}) as DateRangeValue;
      const start = raw.start ? String(raw.start) : "";
      const end = raw.end ? String(raw.end) : "";
      if (!start || !end) return { ok: false, error: `請填寫「${p.label}」的起訖日期` };
      if (!DATE_RE.test(start) || !DATE_RE.test(end)) {
        return { ok: false, error: `「${p.label}」需為 YYYY-MM-DD 日期` };
      }
      if (start > end) return { ok: false, error: `「${p.label}」起始日不可晚於結束日` };
      valueMap.set(`${p.name}_start`, start);
      valueMap.set(`${p.name}_end`, end);
      applied[p.name] = { start, end };
    } else {
      const r = resolveScalar(p, inputValues[p.name]);
      if ("error" in r) return { ok: false, error: r.error };
      valueMap.set(p.name, r.value);
      applied[p.name] = r.value;
    }
  }

  const bound = bindPlaceholders(sqlTemplate, valueMap);
  if ("error" in bound) return { ok: false, error: bound.error };
  return { ok: true, sql: bound.sql, values: bound.values, applied };
}

/** Validate + normalize a raw param-declaration list (from the editor UI). */
export function normalizeParams(raw: unknown): ReportParam[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return "params 需為陣列";
  const seen = new Set<string>();
  const out: ReportParam[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return "每個參數需為物件";
    const o = item as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      return `參數名稱無效：「${name}」（需為英數字/底線，且不以數字開頭）`;
    }
    if (seen.has(name)) return `參數名稱重複：「${name}」`;
    seen.add(name);
    const type = o.type;
    if (type !== "date" && type !== "date_range" && type !== "number" && type !== "text" && type !== "enum") {
      return `參數「${name}」型別無效`;
    }
    const label = typeof o.label === "string" && o.label.trim() ? o.label.trim() : name;
    const required = o.required !== false; // default required
    const param: ReportParam = { name, type, label, required };
    if (type === "enum") {
      const options = Array.isArray(o.options)
        ? o.options.map((x) => String(x).trim()).filter(Boolean)
        : [];
      if (options.length === 0) return `列舉參數「${name}」需至少一個選項`;
      param.options = options;
    }
    if (type !== "date_range" && typeof o.default === "string" && o.default.trim()) {
      param.default = o.default.trim();
    }
    out.push(param);
  }
  return out;
}
