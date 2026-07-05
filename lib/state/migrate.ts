import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Idempotent state-DB migrations. Each statement is `CREATE TABLE IF NOT EXISTS`
 * (or equivalent) so running this repeatedly is safe. Run from the bootstrap
 * script (and future setup scripts). Later slices append their tables here.
 */
export const STATE_MIGRATIONS: string[] = [
  // slice 05 — application users (self-built credentials auth)
  `CREATE TABLE IF NOT EXISTS users (
     id             INT AUTO_INCREMENT PRIMARY KEY,
     email          VARCHAR(191) NOT NULL UNIQUE,
     password_hash  VARCHAR(255) NOT NULL,
     name           VARCHAR(120) NULL,
     created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
   ) CHARACTER SET utf8mb4`,

  // slice 06 — charts a user pinned to their (personal) dashboard, with a data
  // snapshot so restore is self-contained. query_sql is kept for a future
  // "refresh" (re-run live). Personal model: scoped by user_id.
  `CREATE TABLE IF NOT EXISTS pinned_charts (
     id              INT AUTO_INCREMENT PRIMARY KEY,
     user_id         INT NOT NULL,
     title           VARCHAR(255) NOT NULL,
     chart_spec      JSON NOT NULL,
     result_columns  JSON NOT NULL,
     result_rows     JSON NOT NULL,
     query_sql       TEXT NOT NULL,
     position        INT NOT NULL DEFAULT 0,
     created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_user_position (user_id, position, id)
   ) CHARACTER SET utf8mb4`,

  // slice 08 — trusted query library (#3). A confirmed (pinned) question→SQL
  // pair, reused for matching future questions. shared flag is personal (0) for
  // now; flipping it to 1 later upgrades the flywheel to org-wide with no schema
  // change. Unique per (user, normalized question) so re-confirming updates.
  // question_norm reduced to 191 chars (max for utf8mb4 unique index).
  `CREATE TABLE IF NOT EXISTS saved_query (
     id             INT AUTO_INCREMENT PRIMARY KEY,
     user_id        INT NOT NULL,
     question       TEXT NOT NULL,
     question_norm  VARCHAR(191) NOT NULL,
     query_sql      TEXT NOT NULL,
     chart_spec     JSON NOT NULL,
     shared         TINYINT(1) NOT NULL DEFAULT 0,
     created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE KEY uq_user_question (user_id, question_norm)
   ) CHARACTER SET utf8mb4`,

  // slice 07 — conversations for follow-up context. Each turn stores the user
  // question + the SQL produced, so follow-ups ("now break Q3 into weeks") can be
  // fed prior turns, and the chat restores on reload. Personal (user_id-scoped).
  `CREATE TABLE IF NOT EXISTS conversation (
     id          INT AUTO_INCREMENT PRIMARY KEY,
     user_id     INT NOT NULL,
     created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_user (user_id, id)
   ) CHARACTER SET utf8mb4`,
  `CREATE TABLE IF NOT EXISTS conversation_turn (
     id               INT AUTO_INCREMENT PRIMARY KEY,
     conversation_id  INT NOT NULL,
     user_id          INT NOT NULL,
     question         TEXT NOT NULL,
     query_sql        TEXT NOT NULL,
     explanation      TEXT NULL,
     created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_conversation (conversation_id, id)
   ) CHARACTER SET utf8mb4`,

  // slice 03 — the AI-bootstrapped table catalog used for two-stage retrieval.
  // Schema-aware: a row per (schema, table) so the catalog can span multiple
  // selected schemas; retrieval emits schema-qualified names.
  // Schema/table names use VARCHAR(64) (MySQL identifier limit).
  `CREATE TABLE IF NOT EXISTS table_catalog (
     schema_name  VARCHAR(64) NOT NULL,
     table_name   VARCHAR(64) NOT NULL,
     description  TEXT NOT NULL,
     reviewed     TINYINT(1) NOT NULL DEFAULT 0,
     updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
     PRIMARY KEY (schema_name, table_name)
   ) CHARACTER SET utf8mb4`,

  // slice 09 — the Semantic Layer (see docs/adr/0002). Human-authored business
  // knowledge that teaches the AI how to correctly query the DB. Global/shared
  // (no user_id), like table_catalog. A rule's `scope` decides when it's injected:
  //   global — always; term — always (must steer stage-1 table selection);
  //   table  — only when its (schema_name, table_name) is selected in stage-1.
  // Schema/table/term names use VARCHAR(64) (MySQL identifier limit).
  `CREATE TABLE IF NOT EXISTS semantic_rule (
     id           INT AUTO_INCREMENT PRIMARY KEY,
     scope        ENUM('global','term','table') NOT NULL,
     term_name    VARCHAR(64) NULL,
     schema_name  VARCHAR(64) NULL,
     table_name   VARCHAR(64) NULL,
     content      TEXT NOT NULL,
     reviewed     TINYINT(1) NOT NULL DEFAULT 0,
     updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                    ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_scope (scope, schema_name, table_name)
   ) CHARACTER SET utf8mb4`,

  // slice 09 — Relationships (see docs/adr/0001). One uniform directed edge
  // from_col -> to_col plus a cardinality; the reverse (has_many) is derived, not
  // stored. Many-to-many is NOT a stored type — it emerges by walking these edges
  // across a junction table. Schema-qualified so edges span multiple schemas.
  // The whole edge is the unique key, so re-inserting the same edge updates it.
  // Schema/table/column names use VARCHAR(64) (MySQL identifier limit).
  `CREATE TABLE IF NOT EXISTS relationship (
     id            INT AUTO_INCREMENT PRIMARY KEY,
     from_schema   VARCHAR(64) NOT NULL,
     from_table    VARCHAR(64) NOT NULL,
     from_column   VARCHAR(64) NOT NULL,
     to_schema     VARCHAR(64) NOT NULL,
     to_table      VARCHAR(64) NOT NULL,
     to_column     VARCHAR(64) NOT NULL,
     cardinality   ENUM('many_to_one','one_to_one') NOT NULL,
     reviewed      TINYINT(1) NOT NULL DEFAULT 0,
     updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
                     ON UPDATE CURRENT_TIMESTAMP,
     UNIQUE KEY uq_edge (from_schema, from_table, from_column,
                         to_schema, to_table, to_column)
   ) CHARACTER SET utf8mb4`,
];

/**
 * Columns added to pre-existing tables. `CREATE TABLE IF NOT EXISTS` won't touch
 * a table that already exists, so new columns need an idempotent ADD guarded by
 * an information_schema check (MySQL lacks `ADD COLUMN IF NOT EXISTS`).
 */
const COLUMN_ADDITIONS: { table: string; column: string; clause: string }[] = [
  // slice 14 — a Saved Chart's board membership: on_board=1 shown on the grid,
  // 0 = Stashed in the collection tray. Unpin toggles this; only delete removes
  // the row. (see docs/adr/0003)
  { table: "pinned_charts", column: "on_board", clause: "ADD COLUMN on_board TINYINT(1) NOT NULL DEFAULT 1" },
  // slice 14 — grid layout in units (x,y position + w,h size), persisted so a
  // drag/resize survives reload. `position` predates this and is kept only as a
  // stable tiebreaker / legacy order.
  { table: "pinned_charts", column: "x", clause: "ADD COLUMN x INT NOT NULL DEFAULT 0" },
  { table: "pinned_charts", column: "y", clause: "ADD COLUMN y INT NOT NULL DEFAULT 0" },
  { table: "pinned_charts", column: "w", clause: "ADD COLUMN w INT NOT NULL DEFAULT 6" },
  { table: "pinned_charts", column: "h", clause: "ADD COLUMN h INT NOT NULL DEFAULT 8" },
];

async function columnExists(pool: Pool, table: string, column: string): Promise<boolean> {
  const [rows] = (await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      LIMIT 1`,
    [table, column],
  )) as [RowDataPacket[], unknown];
  return rows.length > 0;
}

export async function runStateMigrations(pool: Pool): Promise<void> {
  for (const sql of STATE_MIGRATIONS) {
    await pool.query(sql);
  }
  for (const { table, column, clause } of COLUMN_ADDITIONS) {
    if (!(await columnExists(pool, table, column))) {
      await pool.query(`ALTER TABLE ${table} ${clause}`);
    }
  }
}
