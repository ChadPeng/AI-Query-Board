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

export interface SqlChartRequest {
  question: string;
  /** schema context fed to the model (the selected tables' DDL, from retrieval) */
  schemaDDL: string;
  /** Semantic Layer rules for stage-2: always-injected (global+term) plus the
   *  table-scoped rules of the selected tables. */
  rules?: InjectedRule[];
  /** relationship edges among the selected/connected tables (JOIN hints). */
  relationships?: InjectedRelationship[];
  /** qualified table pairs with no known relationship path, to note for the model. */
  disconnectedPairs?: [string, string][];
  /** prior turns in this conversation, so a follow-up can refine the last query */
  history?: { question: string; sql: string }[];
  /**
   * Present on a repair attempt: the prior SQL ran but its chart_spec referenced
   * columns that weren't in the result set. The model must fix the spec (and/or
   * SQL) so referenced fields exist in the SELECT output.
   */
  repair?: {
    previousSql: string;
    actualColumns: string[];
    missingFields: string[];
  };
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
}
