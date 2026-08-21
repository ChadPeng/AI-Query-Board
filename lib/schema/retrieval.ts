import { getCatalog } from "../state/catalog";
import {
  getAlwaysInjectedRules,
  getTableRules,
  type SemanticRule,
} from "../state/semanticRules";
import { listRelationships, type Relationship } from "../state/relationships";
import { getCreateTablesFor, listColumnsInSchemas, parseQualified, qualifiedName } from "./introspect";
import { connectTables } from "./relationshipGraph";
import type {
  DisconnectedPair,
  InjectedJoinStep,
  InjectedRelationship,
  InjectedRule,
  LLMProvider,
} from "../llm/provider";
import { SAMPLE_SCHEMA_DDL } from "./sampleSchema";
import { keywordScore, tokenize } from "./keywordScore";
import { getNumberSetting } from "../settings/service";

export class NoRelevantTablesError extends Error {
  constructor(suggestions: string[] = []) {
    super(
      suggestions.length > 0
        ? `找不到與問題相關的資料表。名稱上可能相關：${suggestions.join("、")}` +
          `——若其中有對的表，到「語意層」補充它的描述或關係可讓 AI 選得到它。`
        : "找不到與問題相關的資料表",
    );
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
  /** ready-to-copy JOIN chains between the selected tables */
  joinPaths: InjectedJoinStep[][];
  /** selected-table pairs the graph couldn't connect, with shared-column hints */
  disconnected: DisconnectedPair[];
  /** set when this schema came from a curated Dataset (dataset-first routing) */
  datasetName?: string;
}

/** Columns too generic to be a JOIN anchor between two unrelated tables. */
const SHARED_COLUMN_STOP_WORDS = new Set([
  "id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_by",
  "updated_by",
  "status",
  "type",
  "name",
  "sort",
  "remark",
  "note",
  "memo",
  "is_deleted",
]);

/**
 * For each disconnected pair, find column names both tables share (minus
 * stop-words) — a deterministic anchor the model may join on when it truly
 * fits the question. Best-effort: on any failure the pairs pass through with
 * no hint (same information as before, never less).
 */
async function annotateDisconnected(pairs: [string, string][]): Promise<DisconnectedPair[]> {
  if (pairs.length === 0) return [];
  try {
    const schemas = [
      ...new Set(
        pairs.flatMap((p) => p).map((t) => parseQualified(t)?.schema).filter((s): s is string => !!s),
      ),
    ];
    const cols = await listColumnsInSchemas(schemas);
    const byTable = new Map<string, Set<string>>();
    for (const c of cols) {
      const t = qualifiedName(c.schema, c.table);
      (byTable.get(t) ?? byTable.set(t, new Set()).get(t)!).add(c.column.toLowerCase());
    }
    return pairs.map(([a, b]) => {
      const colsA = byTable.get(a);
      const colsB = byTable.get(b);
      const shared =
        colsA && colsB
          ? [...colsA].filter((c) => colsB.has(c) && !SHARED_COLUMN_STOP_WORDS.has(c)).sort()
          : [];
      return { pair: [a, b] as [string, string], sharedColumns: shared.slice(0, 5) };
    });
  } catch {
    return pairs.map((pair) => ({ pair, sharedColumns: [] }));
  }
}

/**
 * Map a raw table name returned by stage-1 selection to its exact
 * schema-qualified catalog entry. Handles a common weak-model failure mode:
 * dropping the schema prefix (e.g. returning "orders" instead of
 * "mepay.orders") despite the prompt instructing otherwise. Falls back to
 * matching by the unqualified table name, but only when it's unambiguous
 * (a single catalog table with that name) — otherwise the guess is unsafe
 * and the table is dropped.
 */
export function resolvePickedTable(
  raw: string,
  candidates: { table: string }[],
  known: Set<string>,
): string | null {
  const cleaned = raw.replace(/[`"']/g, "").trim();
  if (known.has(cleaned)) return cleaned;

  const unqualified = cleaned.includes(".")
    ? cleaned.slice(cleaned.lastIndexOf(".") + 1)
    : cleaned;
  const matches = candidates.filter((c) => {
    const idx = c.table.lastIndexOf(".");
    const name = idx >= 0 ? c.table.slice(idx + 1) : c.table;
    return name.toLowerCase() === unqualified.toLowerCase();
  });
  return matches.length === 1 ? matches[0].table : null;
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
      joinPaths: [],
      disconnected: [],
    };
  }

  // Global + term rules steer stage-1 (so "creator = user.is_creator=1" pulls
  // in the user table) and are injected again at stage-2.
  const alwaysRules = await getAlwaysInjectedRules();

  // Excluded tables (log/scratch/unused) never enter stage-1 selection nor
  // graph-connect — dropping them from the known set is enough to keep them
  // out of the whole pipeline.
  const candidates = catalog
    .filter((c) => !c.excluded)
    .map((c) => ({
      table: qualifiedName(c.schema, c.table),
      description: c.description,
    }));

  // Stage 1: pick relevant tables, keeping only ids that really exist in the
  // catalog (defend against the model inventing a table name). Weaker/free
  // models sometimes drop the schema prefix (e.g. "orders" instead of
  // "mepay.orders") despite the prompt instructing otherwise — fall back to
  // matching by the unqualified table name when it's unambiguous.
  const known = new Set(candidates.map((c) => c.table));
  const resolvePicks = (raw: string[]) =>
    Array.from(
      new Set(
        raw
          .map((t) => resolvePickedTable(t, candidates, known))
          .filter((t): t is string => t != null),
      ),
    );

  let picked = resolvePicks(
    await provider.selectTables({
      question,
      catalog: candidates,
      rules: alwaysRules.map(toInjectedRule),
    }),
  );

  // Fallback re-pick: an empty first pass usually means the model drowned in
  // the full catalog. Narrow it with deterministic keyword scoring (a smaller
  // list is EASIER for a weak model) and explicitly permit best guesses.
  const questionTokens = tokenize(question);
  const scored = candidates
    .map((c) => ({ c, score: keywordScore(questionTokens, c.table, c.description) }))
    .sort((a, b) => b.score - a.score);
  if (picked.length === 0) {
    const narrowed = scored.slice(0, 30).map((s) => s.c);
    picked = resolvePicks(
      await provider.selectTables({
        question,
        catalog: narrowed,
        rules: alwaysRules.map(toInjectedRule),
        retryHint:
          "Your first pass over the full catalog returned no tables. This is a NARROWED catalog of the most likely candidates — return your best guesses (up to 10) even if unsure. An empty list is only correct if the question truly cannot be answered from these tables.",
      }),
    );
  }

  if (picked.length === 0) {
    const suggestions = scored
      .filter((s) => s.score > 0)
      .slice(0, 5)
      .map((s) => s.c.table);
    throw new NoRelevantTablesError(suggestions);
  }

  // Graph-connect: add only the tables that lie on shortest paths between the
  // picked ones (pulls in junction tables so M:N paths join). Keep only tables
  // that exist in the catalog — the graph may reference tables we don't expose.
  // maxHops is a runtime setting (retrieval.max_hops); default 3.
  let maxHops = 3;
  try {
    const v = await getNumberSetting("retrieval.max_hops");
    if (Number.isFinite(v) && v > 0) maxHops = v;
  } catch {
    /* settings unavailable (e.g. bare script) — keep the default */
  }
  const relationships = await listRelationships();
  const connected = connectTables(picked, relationships, maxHops);
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
    joinPaths: connected.paths.map((p) => p.steps),
    disconnected: await annotateDisconnected(connected.disconnectedPairs),
  };
}
