import { getCatalog } from "../state/catalog";
import {
  getAlwaysInjectedRules,
  getTableRules,
  type SemanticRule,
} from "../state/semanticRules";
import { listRelationships, type Relationship } from "../state/relationships";
import { getCreateTablesFor, qualifiedName } from "./introspect";
import { connectTables } from "./relationshipGraph";
import type {
  InjectedRelationship,
  InjectedRule,
  LLMProvider,
} from "../llm/provider";
import { SAMPLE_SCHEMA_DDL } from "./sampleSchema";

export class NoRelevantTablesError extends Error {
  constructor() {
    super("找不到與問題相關的資料表");
    this.name = "NoRelevantTablesError";
  }
}

export interface ResolvedSchema {
  /** DDL to feed the SQL generator. */
  ddl: string;
  /** Tables in play after graph-connect (empty when using the sample fallback). */
  tables: string[];
  /** True when the catalog was empty and we fell back to the sample schema. */
  usedFallback: boolean;
  /** Semantic Layer context for stage-2 (see docs/adr/0002). */
  rules: InjectedRule[];
  relationships: InjectedRelationship[];
  disconnectedPairs: [string, string][];
}

function toInjectedRule(r: SemanticRule): InjectedRule {
  return {
    scope: r.scope,
    termName: r.termName,
    table: r.table,
    content: r.content,
    reviewed: r.reviewed,
  };
}

function toInjectedRelationship(r: Relationship): InjectedRelationship {
  return {
    fromTable: qualifiedName(r.fromSchema, r.fromTable),
    fromColumn: r.fromColumn,
    toTable: qualifiedName(r.toSchema, r.toTable),
    toColumn: r.toColumn,
    cardinality: r.cardinality,
    reviewed: r.reviewed,
  };
}

/**
 * Two-stage schema retrieval (PRD §3.1) augmented with the Semantic Layer
 * (docs/adr/0002):
 *   stage 1 — LLM picks tables from the compact catalog + always-injected rules
 *   graph-connect — add tables on shortest paths between the picked ones
 *   stage 2 (caller) — full DDL + rules + relationship edges
 *
 * Fallback: if the catalog is empty (bootstrap not run yet), use the sample
 * schema so the engine still works during early setup.
 */
export async function resolveSchemaForQuestion(
  question: string,
  provider: LLMProvider,
): Promise<ResolvedSchema> {
  const catalog = await getCatalog();

  if (catalog.length === 0) {
    return {
      ddl: SAMPLE_SCHEMA_DDL,
      tables: [],
      usedFallback: true,
      rules: [],
      relationships: [],
      disconnectedPairs: [],
    };
  }

  // Global + term rules steer stage-1 (so "creator = user.is_creator=1" pulls
  // in the user table) and are injected again at stage-2.
  const alwaysRules = await getAlwaysInjectedRules();

  const candidates = catalog.map((c) => ({
    table: qualifiedName(c.schema, c.table),
    description: c.description,
  }));

  // Stage 1: pick relevant tables, keeping only ids that really exist in the
  // catalog (defend against the model inventing a table name).
  const known = new Set(candidates.map((c) => c.table));
  const picked = (
    await provider.selectTables({
      question,
      catalog: candidates,
      rules: alwaysRules.map(toInjectedRule),
    })
  ).filter((t) => known.has(t));

  if (picked.length === 0) {
    throw new NoRelevantTablesError();
  }

  // Graph-connect: add only the tables that lie on shortest paths between the
  // picked ones (pulls in junction tables so M:N paths join). Keep only tables
  // that exist in the catalog — the graph may reference tables we don't expose.
  const relationships = await listRelationships();
  const connected = connectTables(picked, relationships);
  const finalTables = connected.tables.filter((t) => known.has(t));

  // Stage 2: full DDL for the connected tables.
  const ddl = await getCreateTablesFor(finalTables);
  if (!ddl.trim()) {
    throw new NoRelevantTablesError();
  }

  // Table-scoped rules only for the tables actually in play, plus the
  // always-injected rules, form the stage-2 rule set.
  const tableRules = await getTableRules(finalTables);
  const rules = [...alwaysRules, ...tableRules].map(toInjectedRule);

  return {
    ddl,
    tables: finalTables,
    usedFallback: false,
    rules,
    relationships: connected.edges.map(toInjectedRelationship),
    disconnectedPairs: connected.disconnectedPairs,
  };
}
