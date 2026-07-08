import type { RowDataPacket } from "mysql2/promise";
import { statePool } from "../db";

/**
 * State-DB access for the settings table (the Super-Admin overrides). Resolution
 * (DB → env → default) and typing live in lib/settings; this is just storage.
 */
function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

/** All override rows as a key→value map (value may be an empty string). */
export async function getSettingOverrides(): Promise<Map<string, string>> {
  const [rows] = (await pool().query(
    "SELECT setting_key, setting_value FROM setting",
  )) as [RowDataPacket[], unknown];
  const m = new Map<string, string>();
  for (const r of rows) {
    if (r.setting_value != null) m.set(String(r.setting_key), String(r.setting_value));
  }
  return m;
}

export async function upsertSetting(key: string, value: string, userId: number): Promise<void> {
  await pool().query(
    `INSERT INTO setting (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [key, value, userId],
  );
}

/** Remove an override so the setting reverts to its .env / built-in default. */
export async function deleteSetting(key: string): Promise<void> {
  await pool().query("DELETE FROM setting WHERE setting_key = ?", [key]);
}
