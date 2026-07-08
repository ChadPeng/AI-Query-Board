/**
 * CSV serialization for Report export (Report). Pure — no DB. Prefixes a UTF-8
 * BOM so Excel opens Traditional-Chinese content without mojibake, uses CRLF row
 * endings (Excel-friendly), and quotes any field containing a comma, quote, or
 * newline (doubling embedded quotes per RFC 4180). Column order is preserved.
 */

/** UTF-8 byte-order mark; makes Excel decode the file as UTF-8. */
export const CSV_BOM = "﻿";

function csvField(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const header = columns.map(csvField).join(",");
  if (rows.length === 0) return CSV_BOM + header;
  const body = rows.map((r) => columns.map((c) => csvField(r[c])).join(",")).join("\r\n");
  return CSV_BOM + header + "\r\n" + body;
}
