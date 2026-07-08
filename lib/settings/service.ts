// NOTE: server-only in practice (reads process.env + state DB). Not imported by
// the client bundle. Orchestrates the settings center: DB overrides + env +
// built-in defaults, resolved per setting type (docs/adr/0005).
import { SETTINGS, getSettingDef, type SettingDef } from "./registry";
import { coerceSetting, resolveSetting, type SettingSource, type SettingValue } from "./resolve";
import { getSettingOverrides, upsertSetting, deleteSetting } from "../state/settings";
import { encryptSecret, decryptSecret, isEncrypted } from "./crypto";

/**
 * Small in-memory cache of the DB override map. A Super-Admin edit invalidates it
 * immediately (same process), and a short TTL bounds staleness across restarts /
 * other instances. Changes therefore apply without a server restart.
 */
const TTL_MS = 5000;
let cache: { at: number; map: Map<string, string> } | null = null;

async function overrides(): Promise<Map<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;
  const map = await getSettingOverrides();
  cache = { at: now, map };
  return map;
}

function invalidate() {
  cache = null;
}

export interface ResolvedSetting {
  def: SettingDef;
  value: SettingValue;
  source: SettingSource;
  /** the raw DB override string, or null if none (for editing in the UI) */
  dbValue: string | null;
}

async function resolveOne(def: SettingDef, map: Map<string, string>): Promise<ResolvedSetting> {
  let dbValue = map.has(def.key) ? (map.get(def.key) as string) : null;
  // Secret overrides are stored encrypted; decrypt before resolving so the app
  // sees the real credential. (listSettings re-masks before returning to the UI.)
  if (def.secret && dbValue != null && isEncrypted(dbValue)) {
    dbValue = decryptSecret(dbValue);
  }
  const { value, source } = resolveSetting(def.type, dbValue, process.env[def.envVar], def.default);
  return { def, value, source, dbValue };
}

/** Resolve one setting by key. Throws if the key isn't in the registry. */
export async function getSetting(key: string): Promise<ResolvedSetting> {
  const def = getSettingDef(key);
  if (!def) throw new Error(`未知的設定：${key}`);
  return resolveOne(def, await overrides());
}

export async function getNumberSetting(key: string): Promise<number> {
  const r = await getSetting(key);
  return typeof r.value === "number" ? r.value : Number(r.value);
}

export async function getStringSetting(key: string): Promise<string> {
  const r = await getSetting(key);
  return String(r.value);
}

/** All settings resolved (for the admin page). Secret raw values are masked. */
export async function listSettings(): Promise<ResolvedSetting[]> {
  const map = await overrides();
  const out: ResolvedSetting[] = [];
  for (const def of SETTINGS) {
    const r = await resolveOne(def, map);
    if (def.secret) {
      // never expose a secret's stored value; only whether one is set
      out.push({ ...r, value: r.dbValue ? "********" : "", dbValue: r.dbValue ? "********" : null });
    } else {
      out.push(r);
    }
  }
  return out;
}

/**
 * Set (value !== null) or clear (value === null) a Super-Admin override. Validates
 * the value coerces to the setting's type before storing. Returns an error string
 * on a bad key/value, or null on success.
 */
export async function setSetting(key: string, value: string | null, userId: number): Promise<string | null> {
  const def = getSettingDef(key);
  if (!def) return `未知的設定：${key}`;
  if (value === null) {
    await deleteSetting(key);
  } else {
    if (!coerceSetting(def.type, value).ok) return `「${def.label}」的值格式不符（需為 ${def.type}）`;
    // Secret settings are sealed with AES-256-GCM before they touch the DB.
    await upsertSetting(key, def.secret ? encryptSecret(value) : value, userId);
  }
  invalidate();
  return null;
}
