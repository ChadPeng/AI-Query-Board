import type { ChartSpec } from "./types";

/**
 * The LLM provider seam (PRD §3.3). The engine talks only to this interface;
 * swapping Claude for GPT or a local Ollama model later is a new adapter, not
 * a change to the engine.
 */

/**
 * A Semantic Layer rule as fed to the model. `reviewed=false` means an
 * AI-bootstrapped draft nobody has confirmed yet — the prompt marks it so the
 * model trusts it less (see docs/adr/0002).
 */
export interface InjectedRule {
  scope: "global" | "term" | "table";
  /** the concept name for scope='term' (e.g. "創作者") */
  termName?: string | null;
  /** the bound schema-qualified table for scope='table' */
  table?: string | null;
  content: string;
  reviewed: boolean;
}

/** A relationship edge as fed to the model — a JOIN hint the DDL lacks. */
export interface InjectedRelationship {
  /** schema-qualified "schema.table" */
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: "many_to_one" | "one_to_one";
  reviewed: boolean;
}

/** One hop of a pre-computed JOIN chain between selected tables. */
export interface InjectedJoinStep {
  /** schema-qualified "schema.table" */
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  reviewed: boolean;
}

/** A selected-table pair the relationship graph could not connect. */
export interface DisconnectedPair {
  /** schema-qualified tables */
  pair: [string, string];
  /** column names both tables share (stop-words removed) — a deterministic
   *  anchor for the model instead of a blind "decide yourself" */
  sharedColumns: string[];
}

/**
 * Context for a repair attempt. Two failure classes share the repair loop:
 *  - chart_mismatch: the SQL ran, but the chart_spec referenced columns absent
 *    from the result set — fix the spec (and/or SQL aliases).
 *  - sql_error: MySQL rejected the SQL (unknown column / missing table / syntax
 *    / ambiguous column…). The raw error is fed back; `addedDdl` optionally
 *    carries DDL of tables the engine deterministically identified as holding
 *    what the SQL referenced (e.g. the table that actually has the column).
 */
export type SqlRepairContext =
  | {
      kind: "chart_mismatch";
      previousSql: string;
      actualColumns: string[];
      missingFields: string[];
    }
  | {
      kind: "sql_error";
      previousSql: string;
      errorMessage: string;
      addedDdl?: string;
    };

export interface SqlChartRequest {
  question: string;
  /** schema context fed to the model (the selected tables' DDL, from retrieval) */
  schemaDDL: string;
  /** Semantic Layer rules for stage-2: always-injected (global+term) plus the
   *  table-scoped rules of the selected tables. */
  rules?: InjectedRule[];
  /** relationship edges among the selected/connected tables (JOIN hints). */
  relationships?: InjectedRelationship[];
  /** pre-computed shortest JOIN chains between the selected tables — the model
   *  should copy these instead of re-deriving multi-hop joins. */
  joinPaths?: InjectedJoinStep[][];
  /** selected-table pairs with no known relationship path, to note for the model. */
  disconnected?: DisconnectedPair[];
  /** prior turns in this conversation, so a follow-up can refine the last query */
  history?: { question: string; sql: string }[];
  /** confirmed question→SQL pairs on the same tables, as demonstrations */
  examples?: { question: string; sql: string }[];
  /** present on a repair attempt — see SqlRepairContext */
  repair?: SqlRepairContext;
}

export interface SqlChartResponse {
  sql: string;
  chart_spec: ChartSpec;
  explanation: string;
}

/** Stage 1 of retrieval: pick the relevant tables for a question. */
export interface TableSelectionRequest {
  question: string;
  catalog: { table: string; description: string }[];
  /** always-injected Semantic Layer rules (global + term) so business concepts
   *  like "創作者 = user.is_creator=1" can steer which tables get picked. */
  rules?: InjectedRule[];
  /** present on the fallback re-pick after an empty first pass */
  retryHint?: string;
}

/** Used by the bootstrap script to generate a one-line table description. */
export interface DescribeTableRequest {
  table: string;
  createTable: string;
  sampleRows: Record<string, unknown>[];
}

/** Trusted-query reuse: find a saved question equivalent to the new one. */
export interface SavedQuestionMatchRequest {
  question: string;
  candidates: { id: number; question: string }[];
}

/** Learn Semantic Layer drafts from example SQL the user pastes. */
export interface LearnFromSqlRequest {
  /** one or more SQL statements */
  sql: string;
  /** the schema-qualified tables that exist, so the model uses real names */
  knownTables: string[];
}

export interface LearnedRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: "many_to_one" | "one_to_one";
}

export interface LearnedRule {
  scope: "global" | "term" | "table";
  termName?: string | null;
  table?: string | null;
  content: string;
}

export interface LearnFromSqlResult {
  relationships: LearnedRelationship[];
  rules: LearnedRule[];
}

/** Relationship discovery (JOIN 可靠性第二波): propose edges for FK-looking columns. */
export interface CandidateFkColumn {
  /** schema-qualified source table */
  table: string;
  column: string;
  dataType: string;
  /** a few DISTINCT values so the model can sanity-check "does this look like a key" */
  sampleValues: string[];
}

export interface RelationshipTarget {
  /** schema-qualified table with a single-column primary key */
  table: string;
  pkColumn: string;
  pkType: string;
}

export interface SuggestRelationshipsRequest {
  candidates: CandidateFkColumn[];
  /** the ONLY tables a proposal may reference (hallucination whitelist) */
  targets: RelationshipTarget[];
}

/** Dataset-first routing (BI 第四波): match a question to a curated Dataset. */
export interface DatasetMatchRequest {
  question: string;
  candidates: { id: number; name: string; description: string }[];
}

export interface LLMProvider {
  /** Stage 1: return the subset of catalog table names relevant to the question. */
  selectTables(req: TableSelectionRequest): Promise<string[]>;
  /** Stage 2: generate SQL + chart spec from the selected tables' DDL. */
  generateSqlAndChart(req: SqlChartRequest): Promise<SqlChartResponse>;
  /** Bootstrap: one-line description of a table from its DDL + sample rows. */
  describeTable(req: DescribeTableRequest): Promise<string>;
  /** Reuse: id of the semantically-equivalent saved question, or null. */
  matchSavedQuestion(req: SavedQuestionMatchRequest): Promise<number | null>;
  /** Extract relationship + rule drafts from example SQL. */
  learnFromSql(req: LearnFromSqlRequest): Promise<LearnFromSqlResult>;
  /** Discovery: propose FK edges for suspected-FK columns (targets whitelisted). */
  suggestRelationships(req: SuggestRelationshipsRequest): Promise<LearnedRelationship[]>;
  /** Dataset-first routing: id of the ONE covering Dataset, or null (conservative). */
  matchDataset(req: DatasetMatchRequest): Promise<number | null>;
}
