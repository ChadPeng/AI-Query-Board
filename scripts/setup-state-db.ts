/**
 * Create the state database (if missing) and run all state migrations.
 *
 * The app connects to a specific database (STATE_DB_DATABASE), so that database
 * must exist before the app can run its migrations. This script connects without
 * a database to CREATE it, then runs the migrations into it.
 *
 *   npm run setup:state
 */
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import { runStateMigrations } from "../lib/state/migrate";

function ident(name: string): string {
  return "`" + name.replace(/`/g, "``") + "`";
}

/** Demo account, seeded idempotently so a fresh setup can log in immediately. */
const SEED_EMAIL = "admin@gmail.com";
const SEED_PASSWORD = "admin";
const SEED_NAME = "Admin";

async function seedDemoUser(pool: mysql.Pool): Promise<void> {
  const [existing] = (await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [
    SEED_EMAIL,
  ])) as [{ id: number }[], unknown];
  if (existing.length > 0) {
    // Idempotently ensure the seed account is the first super_admin (docs/adr/0004).
    await pool.query("UPDATE users SET role = 'super_admin' WHERE email = ?", [SEED_EMAIL]);
    console.log(`✓ demo 帳號已存在：${SEED_EMAIL}（確保為 super_admin）`);
    return;
  }
  const hash = await bcrypt.hash(SEED_PASSWORD, 10);
  await pool.query("INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, 'super_admin')", [
    SEED_EMAIL,
    hash,
    SEED_NAME,
  ]);
  console.log(`✓ demo 帳號已建立：${SEED_EMAIL} / ${SEED_PASSWORD}（super_admin）`);
}

async function main() {
  const host = process.env.STATE_DB_HOST;
  const port = Number(process.env.STATE_DB_PORT || 3306);
  const user = process.env.STATE_DB_USER;
  const password = process.env.STATE_DB_PASSWORD ?? "";
  const database = process.env.STATE_DB_DATABASE;

  if (!host || !user || !database) {
    throw new Error("STATE_DB_HOST / STATE_DB_USER / STATE_DB_DATABASE 必須設定");
  }

  // 1. Create the database (connect with no default database). Best-effort: a
  // least-privilege state account may lack the server-level CREATE DATABASE
  // privilege while the database already exists — tolerate that and continue.
  const admin = await mysql.createConnection({
    host,
    port,
    user,
    password,
    connectTimeout: 8000,
    multipleStatements: false,
  });
  try {
    await admin.query(`CREATE DATABASE IF NOT EXISTS ${ident(database)} CHARACTER SET utf8mb4`);
    console.log(`✓ database ${database} ready on ${host}:${port}`);
  } catch (e) {
    const [rows] = (await admin.query("SHOW DATABASES LIKE ?", [database])) as [unknown[], unknown];
    if (rows.length === 0) throw e; // truly missing and we can't create it
    console.log(`✓ database ${database} already exists（帳號無 CREATE DATABASE 權限，略過建立）`);
  }
  await admin.end();

  // 2. Run migrations into it.
  const pool = mysql.createPool({ host, port, user, password, database, connectionLimit: 3 });
  await runStateMigrations(pool);
  const [rows] = (await pool.query(
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [database],
  )) as [{ t: string }[], unknown];
  console.log(`✓ migrations applied. tables in ${database}:`);
  console.log("  " + rows.map((r) => r.t).join(", "));
  await seedDemoUser(pool);
  await pool.end();
}

main()
  .then(() => {
    console.log("\n完成。可以啟動 app 並註冊帳號了。");
    process.exit(0);
  })
  .catch((e) => {
    console.error("setup 失敗：", e instanceof Error ? e.message : e);
    process.exit(1);
  });
