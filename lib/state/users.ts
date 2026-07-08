import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { statePool } from "../db";
import { isRole, type Role } from "../auth/permissions";

export interface UserRow {
  id: number;
  email: string;
  passwordHash: string;
  name: string | null;
  role: Role;
}

/** A user without the password hash — safe to return from admin listings. */
export interface UserSummary {
  id: number;
  email: string;
  name: string | null;
  role: Role;
}

function pool() {
  const p = statePool();
  if (!p) throw new Error("狀態資料庫未設定（STATE_DB_* 環境變數）");
  return p;
}

/** Coerce a DB value to a Role, defaulting to the least-privileged tier. */
function toRole(value: unknown): Role {
  return isRole(value) ? value : "viewer";
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const [rows] = (await pool().query(
    "SELECT id, email, password_hash, name, role FROM users WHERE email = ? LIMIT 1",
    [email],
  )) as [RowDataPacket[], unknown];
  const r = rows[0];
  if (!r) return null;
  return {
    id: Number(r.id),
    email: String(r.email),
    passwordHash: String(r.password_hash),
    name: r.name == null ? null : String(r.name),
    role: toRole(r.role),
  };
}

export async function listUsers(): Promise<UserSummary[]> {
  const [rows] = (await pool().query(
    "SELECT id, email, name, role FROM users ORDER BY id",
  )) as [RowDataPacket[], unknown];
  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email),
    name: r.name == null ? null : String(r.name),
    role: toRole(r.role),
  }));
}

/** Assign a user's role. Returns false if no such user. */
export async function setUserRole(id: number, role: Role): Promise<boolean> {
  const [res] = (await pool().query("UPDATE users SET role = ? WHERE id = ?", [
    role,
    id,
  ])) as [ResultSetHeader, unknown];
  return res.affectedRows > 0;
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
