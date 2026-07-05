import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";

export interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
  name: string | null;
}

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = (await pool().query(
    "SELECT id, email, password_hash, name FROM users WHERE email = ? LIMIT 1",
    [email],
  )) as [RowDataPacket[], unknown];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    name: r.name == null ? null : String(r.name),
  };
}

export async function createUser(
  email: string,
  passwordHash: string,
  name: string | null,
): Promise<number> {
  const [res] = (await pool().query(
    "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)",
    [email, passwordHash, name],
  )) as [ResultSetHeader, unknown];
  return res.insertId;
}
