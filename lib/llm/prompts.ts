import type {
  DescribeTableRequest,
  InjectedRelationship,
  InjectedRule,
  LearnFromSqlRequest,
  LearnFromSqlResult,
  SavedQuestionMatchRequest,
  SqlChartRequest,
  TableSelectionRequest,
} from "./provider";

/**
 * Shared prompts for every LLM provider, so Claude / Gemini / future adapters
 * behave identically. System prompts describe the exact JSON shape so a provider
 * using plain JSON mode (Gemini) produces the right keys; providers with a
 * native structured-output schema (Claude) enforce the same shape via the schema.
 */

export const SQL_SYSTEM = `You are a careful data analyst that translates natural-language questions into a single read-only MySQL SELECT query and a chart specification.

Rules:
- Produce exactly one SELECT statement (you may use a CTE with WITH). Never write INSERT/UPDATE/DELETE/DDL.
- Use only the tables and columns in the provided schema. Do not invent columns.
- Reference each table by the EXACT name shown above its definition. When a table is shown with a schema-qualified name (e.g. \`magento2\`.\`sales_order\`), use that full schema-qualified name in your SQL — tables may come from different schemas.
- Alias computed/aggregated columns with clear snake_case names (e.g. SELECT SUM(amount) AS total_revenue).
- The chart_spec's "x" and every entry in "y" MUST be column names that appear in your SELECT output (use the aliases you defined).
- Pick the simplest chart that answers the question: time series -> line; category comparison -> bar; parts of a whole -> pie; raw rows -> table.
- Keep result sets reasonable; prefer aggregated/grouped results over dumping raw rows.
- You may be given "Semantic rules" (business meaning the schema can't express — code meanings, metric definitions, filters) and "Table relationships" (join edges the DDL doesn't declare). TREAT THESE AS AUTHORITATIVE: apply the relevant filters, join on the stated columns, and compute metrics as defined. A relationship marked "many-to-one" means many rows on the from-side per one row on the to-side — aggregate/GROUP BY accordingly.
- Rules or relationships marked "（未確認）" are AI guesses not yet human-verified: use them, but if one contradicts the schema or the question, prefer the schema.

Return a JSON object with exactly these keys:
{
  "sql": string,
  "chart_spec": {
    "chart_type": "bar" | "line" | "area" | "pie" | "table",
    "x": string,
    "y": string[],
    "title": string,
    "aggregation": "sum" | "avg" | "count" | "min" | "max" | "none"
  },
  "explanation": string  // one short sentence, in the user's language
}`;

export const SELECT_SYSTEM = `You are a schema-routing assistant. Given a user's data question and a catalog of tables (each with a one-line description), pick ONLY the tables needed to answer the question — typically 3 to 8, never more than 10. Choose tables you'd need to JOIN as well, not just the obvious one. Return only table names that appear in the catalog.

You may also be given "Semantic rules" — business definitions of terms (e.g. a "creator" is a row in the user table with is_creator=1). Use them to map the question's business concepts to the tables that hold that data, and include those tables. Rules marked "（未確認）" are unverified AI guesses — still useful for routing.

Return a JSON object: { "tables": string[] }`;

export const SAVED_MATCH_SYSTEM = `Given a new data question and a list of previously-saved questions (id: text), return the id of the one that asks for the SAME data intent (a paraphrase / equivalent). Be conservative: return null unless one is clearly equivalent. Never invent an id.

Return a JSON object: { "match_id": number | null }`;

export const DESCRIBE_SYSTEM =
  "用一句精簡的繁體中文描述這張資料表存放什麼資料、典型用途。只回傳那一句話，不要前綴、不要引號、不要 markdown。";

export const LEARN_SYSTEM = `You extract reusable Semantic Layer knowledge from example SQL that an analyst actually ran. You are given one or more SQL statements and the list of tables that exist (schema-qualified). Infer:

1. Relationships — from JOIN ... ON conditions (a.col = b.col). Emit a directed edge from the "many" side's foreign-key column to the "one" side's key. Cardinality is usually "many_to_one"; use "one_to_one" only if the columns are both unique keys. Use the EXACT schema-qualified table names from the provided list; skip any table not in the list.

2. Rules — business meaning encoded in the SQL:
   - A WHERE on a code column (e.g. status = 3, type = 'A') → a scope="table" rule for that table describing the code condition. Note the meaning if obvious; otherwise state the observed condition.
   - A recurring filter (e.g. is_deleted = 0, deleted_at IS NULL) → scope="global" (if it plausibly applies everywhere) or scope="table".
   - A defining condition for a business concept (e.g. is_creator = 1 means a creator) → scope="term" with a termName.
   Write rule content in Traditional Chinese, concise.

Do NOT invent tables or columns not present in the SQL. Only report what the SQL actually shows. It is fine to return empty arrays.

Return a JSON object:
{
  "relationships": [{ "fromTable": string, "fromColumn": string, "toTable": string, "toColumn": string, "cardinality": "many_to_one" | "one_to_one" }],
  "rules": [{ "scope": "global" | "term" | "table", "termName": string | null, "table": string | null, "content": string }]
}`;

const unconfirmed = (reviewed: boolean) => (reviewed ? "" : "（未確認）");

function formatRule(r: InjectedRule): string {
  const mark = unconfirmed(r.reviewed);
  if (r.scope === "term" && r.termName) return `- 「${r.termName}」：${r.content}${mark}`;
  if (r.scope === "table" && r.table) return `- (${r.table}) ${r.content}${mark}`;
  return `- ${r.content}${mark}`;
}

/** Rules section, or "" when there are none. */
export function formatRules(rules: InjectedRule[] | undefined): string {
  if (!rules || rules.length === 0) return "";
  return `Semantic rules (business meaning — authoritative):\n${rules.map(formatRule).join("\n")}`;
}

function formatRelationship(r: InjectedRelationship): string {
  const card = r.cardinality === "one_to_one" ? "一對一" : "多對一";
  return `- \`${r.fromTable}\`.${r.fromColumn} → \`${r.toTable}\`.${r.toColumn}（${card}）${unconfirmed(r.reviewed)}`;
}

/** Relationships (JOIN hints) section, or "" when there are none. */
export function formatRelationships(rels: InjectedRelationship[] | undefined): string {
  if (!rels || rels.length === 0) return "";
  return `Table relationships (join on these columns — the DDL omits them):\n${rels.map(formatRelationship).join("\n")}`;
}

function formatDisconnected(pairs: [string, string][] | undefined): string {
  if (!pairs || pairs.length === 0) return "";
  const list = pairs.map(([a, b]) => `${a} ↔ ${b}`).join("; ");
  return `Note: no known relationship connects these selected tables — decide for yourself whether/how to join them: ${list}`;
}

export function buildSqlUserPrompt(req: SqlChartRequest): string {
  const parts = [`Database schema:\n${req.schemaDDL}`];

  const rules = formatRules(req.rules);
  if (rules) parts.push(`\n${rules}`);
  const rels = formatRelationships(req.relationships);
  if (rels) parts.push(`\n${rels}`);
  const disconnected = formatDisconnected(req.disconnectedPairs);
  if (disconnected) parts.push(`\n${disconnected}`);

  if (req.history && req.history.length > 0) {
    const turns = req.history
      .map((h, i) => `(${i + 1}) Q: ${h.question}\n    SQL: ${h.sql}`)
      .join("\n");
    parts.push(
      `\nConversation so far (each = a prior question and the SQL you produced). ` +
        `The new question may be a FOLLOW-UP that refines the most recent one ` +
        `(e.g. change the grouping, time range, or breakdown) — in that case adapt the prior SQL. ` +
        `If it is unrelated, answer it standalone.\n${turns}`,
    );
  }

  parts.push(`\nNew question: ${req.question}`);
  if (req.repair) {
    parts.push(
      `\nYour previous SQL ran successfully but the chart_spec referenced columns that are NOT in the result set.` +
        `\nPrevious SQL:\n${req.repair.previousSql}` +
        `\nActual result columns: ${req.repair.actualColumns.join(", ") || "(none)"}` +
        `\nMissing referenced fields: ${req.repair.missingFields.join(", ")}` +
        `\nFix this: either change chart_spec.x / chart_spec.y to use the actual result columns, or adjust the SQL so the referenced columns are SELECTed (with matching aliases).`,
    );
  }
  return parts.join("\n");
}

export function buildSelectUserPrompt(req: TableSelectionRequest): string {
  const catalogText = req.catalog
    .map((c) => `- ${c.table}: ${c.description}`)
    .join("\n");
  const rules = formatRules(req.rules);
  return (
    `Table catalog:\n${catalogText}` +
    (rules ? `\n\n${rules}` : "") +
    `\n\nQuestion: ${req.question}`
  );
}

export function buildSavedMatchUserPrompt(req: SavedQuestionMatchRequest): string {
  const list = req.candidates.map((c) => `${c.id}: ${c.question}`).join("\n");
  return `Saved questions:\n${list}\n\nNew question: ${req.question}`;
}

export function buildDescribeUserPrompt(req: DescribeTableRequest): string {
  const sample = JSON.stringify(req.sampleRows, null, 0).slice(0, 1500);
  return `CREATE TABLE:\n${req.createTable}\n\n範例資料（最多數筆）:\n${sample}`;
}

export function buildLearnUserPrompt(req: LearnFromSqlRequest): string {
  const tableList = req.knownTables.length
    ? req.knownTables.map((t) => `- ${t}`).join("\n")
    : "(catalog empty — infer table names as written in the SQL)";
  return `Existing tables (use these exact names):\n${tableList}\n\nSQL:\n${req.sql}`;
}

const CARDS = new Set(["many_to_one", "one_to_one"]);
const SCOPES = new Set(["global", "term", "table"]);

/**
 * Defensively shape a loosely-parsed model response into a LearnFromSqlResult.
 * Providers using plain JSON mode (Gemini, OpenAI-compatible) route through this;
 * anything malformed is dropped rather than trusted.
 */
export function coerceLearnResult(raw: unknown): LearnFromSqlResult {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const rels = Array.isArray(obj.relationships) ? obj.relationships : [];
  const rules = Array.isArray(obj.rules) ? obj.rules : [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return {
    relationships: rels
      .map((r) => r as Record<string, unknown>)
      .filter((r) => CARDS.has(String(r.cardinality)))
      .map((r) => ({
        fromTable: str(r.fromTable),
        fromColumn: str(r.fromColumn),
        toTable: str(r.toTable),
        toColumn: str(r.toColumn),
        cardinality: String(r.cardinality) as "many_to_one" | "one_to_one",
      }))
      .filter((r) => r.fromTable && r.fromColumn && r.toTable && r.toColumn),
    rules: rules
      .map((r) => r as Record<string, unknown>)
      .filter((r) => SCOPES.has(String(r.scope)) && str(r.content))
      .map((r) => ({
        scope: String(r.scope) as "global" | "term" | "table",
        termName: str(r.termName) || null,
        table: str(r.table) || null,
        content: str(r.content),
      })),
  };
}
