/**
 * Setting resolution (docs/adr/0005). Pure — no DB, no process.env. Given the
 * three candidate sources for a setting (DB override → .env default → built-in
 * default), pick the first that coerces to the declared type, and report which
 * source won so the UI can show it. This is the testable core of the settings
 * center; the service layer supplies the DB and env strings.
 */

export type SettingType = "number" | "string" | "list" | "boolean";
export type SettingValue = number | string | string[] | boolean;
export type SettingSource = "db" | "env" | "default";

export interface Resolved {
  value: SettingValue;
  source: SettingSource;
}

/** Coerce a raw string to the declared type. `ok:false` means the raw is invalid
 *  for this type (e.g. "abc" as a number) and the caller should try the next source. */
export function coerceSetting(type: SettingType, raw: string): { ok: true; value: SettingValue } | { ok: false } {
  switch (type) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    case "boolean": {
      const s = raw.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(s)) return { ok: true, value: true };
      if (["0", "false", "no", "off", ""].includes(s)) return { ok: true, value: false };
      return { ok: false };
    }
    case "list":
      return { ok: true, value: raw.split(",").map((s) => s.trim()).filter(Boolean) };
    case "string":
      return { ok: true, value: raw };
  }
}

/**
 * Resolve a setting from its candidate sources, in precedence order
 * DB → env → built-in default. `defaultValue` must be valid for the type (it's
 * the authored fallback), so resolution always yields a value.
 */
export function resolveSetting(
  type: SettingType,
  dbValue: string | null | undefined,
  envValue: string | undefined,
  defaultValue: string,
): Resolved {
  const candidates: [SettingSource, string | null | undefined][] = [
    ["db", dbValue],
    ["env", envValue],
    ["default", defaultValue],
  ];
  for (const [source, raw] of candidates) {
    if (raw === null || raw === undefined) continue;
    const c = coerceSetting(type, raw);
    if (c.ok) return { value: c.value, source };
  }
  // defaultValue is authored to be valid; this is a total-function guarantee.
  const fallback = coerceSetting(type, defaultValue);
  return { value: fallback.ok ? fallback.value : defaultValue, source: "default" };
}
