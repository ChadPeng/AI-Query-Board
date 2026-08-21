import type { LearnedRelationship, LLMProvider, RelationshipTarget, CandidateFkColumn } from "./llm/provider";
import type { ColumnInfo } from "./schema/introspect";
import { parseQualified, qualifiedName, sampleDistinctValues } from "./schema/introspect";
import { listColumnsInSchemas } from "./schema/introspect";
import { getCatalog } from "./state/catalog";
import { listRelationships, createRelationship } from "./state/relationships";
import { listRules } from "./state/semanticRules";
import { computeCoverage, type FkGap } from "./schema/coverage";
import { analyticsPool } from "./db";

/**
 * LLM-assisted relationship discovery (JOIN 可靠性第二波). Three defense layers
 * so a weak model can only nominate, never decide:
 *   1. deterministic candidate narrowing — the health check's FK gaps (name
 *      pattern, no existing edge) × type-compatible single-PK targets;
 *   2. the LLM proposes edges from a whitelisted target list;
 *   3. a value-overlap probe (read-only) is the final judge — only proposals
 *      whose sample values actually hit the target PK become reviewed=0 drafts.
 */

export type ProposalAction = "created" | "review" | "rejected" | "unverified" | "invalid";

export interface ProposalResult extends LearnedRelationship {
  /** matched/total of the value-overlap probe; null when the probe didn't run */
  matchRate: number | null;
  action: ProposalAction;
}

export interface DiscoveryReport {
  candidatesConsidered: number;
  proposals: ProposalResult[];
  created: number;
}

export interface DiscoveryOptions {
  /** source tables per LLM call (keep small for weak models) */
  batchSize?: number;
  /** stop after this many candidate source tables (resume by re-running) */
  limit?: number;
  /** propose only — no probe, no writes */
  dryRun?: boolean;
  log?: (msg: string) => void;
  /** pause between LLM calls (rate limits on free tiers) */
  sleepMs?: number;
}

const ACCEPT_RATE = 0.8;
const REVIEW_RATE = 0.5;
const PROBE_DISTINCT_LIMIT = 200;

const INT_TYPES = new Set(["int", "bigint", "smallint", "tinyint", "mediumint"]);
const CHAR_TYPES = new Set(["varchar", "char"]);

/** Coarse type family — a FK and its PK must at least share this. */
export function typeFamily(dataType: string): "int" | "char" | "other" {
  const t = dataType.toLowerCase();
  if (INT_TYPES.has(t)) return "int";
  if (CHAR_TYPES.has(t)) return "char";
  return "other";
}

/** Single-column-PK tables usable as proposal targets. */
export function buildTargets(columns: ColumnInfo[], activeTables: Set<string>): RelationshipTarget[] {
  const pksByTable = new Map<string, ColumnInfo[]>();
  for (const c of columns) {
    if (c.columnKey !== "PRI") continue;
    const t = qualifiedName(c.schema, c.table);
    if (!activeTables.has(t)) continue;
    (pksByTable.get(t) ?? pksByTable.set(t, []).get(t)!).push(c);
  }
  const targets: RelationshipTarget[] = [];
  for (const [table, pks] of pksByTable) {
    if (pks.length === 1) {
      targets.push({ table, pkColumn: pks[0].column, pkType: pks[0].dataType });
    }
  }
  return targets.sort((a, b) => a.table.localeCompare(b.table));
}

/**
 * Post-LLM whitelist: the from-side must be one of the offered candidates and
 * the target must be in the offered list; toColumn is FORCED to the target's
 * real PK (the model only picks the table, it can't invent a column).
 */
export function filterValidProposals(
  proposals: LearnedRelationship[],
  candidates: CandidateFkColumn[],
  targets: RelationshipTarget[],
): LearnedRelationship[] {
  const candidateKeys = new Set(candidates.map((c) => `${c.table}.${c.column.toLowerCase()}`));
  const targetByTable = new Map(targets.map((t) => [t.table, t]));
  const seen = new Set<string>();
  const out: LearnedRelationship[] = [];
  for (const p of proposals) {
    const key = `${p.fromTable}.${p.fromColumn.toLowerCase()}`;
    const target = targetByTable.get(p.toTable);
    if (!candidateKeys.has(key) || !target) continue;
    if (p.fromTable === p.toTable) continue; // self-references need human eyes
    if (seen.has(key)) continue; // one proposal per candidate column
    seen.add(key);
    out.push({ ...p, toColumn: target.pkColumn });
  }
  return out;
}

/** matched/total of DISTINCT candidate values that hit the target PK. */
async function probeValueOverlap(p: LearnedRelationship): Promise<number | null> {
  const pool = analyticsPool();
  if (!pool) return null;
  const from = parseQualified(p.fromTable);
  const to = parseQualified(p.toTable);
  if (!from || !to) return null;
  const q = (s: string) => "`" + s.replace(/`/g, "``") + "`";
  try {
    const [rows] = (await pool.query(
      `SELECT COUNT(*) AS total, COUNT(t.pk) AS matched
         FROM (SELECT DISTINCT ${q(p.fromColumn)} AS v
                 FROM ${q(from.schema)}.${q(from.table)}
                WHERE ${q(p.fromColumn)} IS NOT NULL
                LIMIT ${PROBE_DISTINCT_LIMIT}) s
         LEFT JOIN (SELECT ${q(p.toColumn)} AS pk
                      FROM ${q(to.schema)}.${q(to.table)}) t
           ON t.pk = s.v`,
    )) as [{ total: number; matched: number }[], unknown];
    const r = rows[0];
    if (!r || Number(r.total) === 0) return null;
    return Number(r.matched) / Number(r.total);
  } catch {
    return null; // collation mismatch etc. — report as unverified
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function discoverRelationships(
  provider: LLMProvider,
  opts: DiscoveryOptions = {},
): Promise<DiscoveryReport> {
  const { batchSize = 5, limit, dryRun = false, sleepMs = 2000, log = () => {} } = opts;

  const [catalog, relationships, rules] = await Promise.all([
    getCatalog(),
    listRelationships(),
    listRules(),
  ]);
  const active = catalog.filter((c) => !c.excluded);
  const activeTables = new Set(active.map((c) => qualifiedName(c.schema, c.table)));
  const schemas = [...new Set(active.map((c) => c.schema))];
  const columns = await listColumnsInSchemas(schemas);

  // Layer 1: the health check's gap list IS the worklist.
  const { fkGaps } = computeCoverage(catalog, relationships, rules, columns, true);
  const typeByColumn = new Map(
    columns.map((c) => [`${qualifiedName(c.schema, c.table)}.${c.column}`, c.dataType]),
  );
  const targets = buildTargets(columns, activeTables);
  log(`缺口欄位 ${fkGaps.length} 個；候選目標表 ${targets.length} 張`);

  // Group gaps by source table; respect --limit for resumable runs.
  const byTable = new Map<string, FkGap[]>();
  for (const gap of fkGaps) {
    (byTable.get(gap.table) ?? byTable.set(gap.table, []).get(gap.table)!).push(gap);
  }
  const sourceTables = [...byTable.keys()].sort().slice(0, limit ?? byTable.size);

  const report: DiscoveryReport = {
    candidatesConsidered: 0,
    proposals: [],
    created: 0,
  };

  for (let i = 0; i < sourceTables.length; i += batchSize) {
    const batchTables = sourceTables.slice(i, i + batchSize);

    // Build candidates with sample values (best-effort per column).
    const candidates: CandidateFkColumn[] = [];
    for (const table of batchTables) {
      const parsed = parseQualified(table);
      if (!parsed) continue;
      for (const gap of byTable.get(table) ?? []) {
        let sampleValues: string[] = [];
        try {
          sampleValues = await sampleDistinctValues(parsed.schema, parsed.table, gap.column);
        } catch {
          /* sampling is optional */
        }
        candidates.push({ table, column: gap.column, dataType: gap.dataType, sampleValues });
      }
    }
    if (candidates.length === 0) continue;
    report.candidatesConsidered += candidates.length;

    // Layer 1b: only offer type-compatible targets for this batch.
    const familiesInBatch = new Set(candidates.map((c) => typeFamily(c.dataType)));
    const batchTargets = targets.filter((t) => familiesInBatch.has(typeFamily(t.pkType)));

    // Layer 2: the model nominates.
    log(`batch ${Math.floor(i / batchSize) + 1}：${candidates.length} 個候選欄位 → LLM`);
    let proposals: LearnedRelationship[] = [];
    try {
      proposals = await provider.suggestRelationships({ candidates, targets: batchTargets });
    } catch (e) {
      log(`  LLM 呼叫失敗，略過此 batch：${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const valid = filterValidProposals(proposals, candidates, targets);
    const dropped = proposals.length - valid.length;
    if (dropped > 0) log(`  擋下 ${dropped} 條不在白名單內的提案`);

    // Extra type gate: candidate column family must match the target PK family.
    const typed = valid.filter((p) => {
      const fromType = typeByColumn.get(`${p.fromTable}.${p.fromColumn}`) ?? "";
      const target = targets.find((t) => t.table === p.toTable);
      return target && typeFamily(fromType) === typeFamily(target.pkType);
    });

    // Layer 3: the probe decides.
    for (const p of typed) {
      if (dryRun) {
        report.proposals.push({ ...p, matchRate: null, action: "review" });
        continue;
      }
      const rate = await probeValueOverlap(p);
      let action: ProposalAction;
      if (rate === null) {
        action = "unverified";
      } else if (rate >= ACCEPT_RATE) {
        action = "created";
      } else if (rate >= REVIEW_RATE) {
        action = "review";
      } else {
        action = "rejected";
      }
      if (action === "created") {
        const from = parseQualified(p.fromTable)!;
        const to = parseQualified(p.toTable)!;
        await createRelationship({
          fromSchema: from.schema,
          fromTable: from.table,
          fromColumn: p.fromColumn,
          toSchema: to.schema,
          toTable: to.table,
          toColumn: p.toColumn,
          cardinality: p.cardinality,
          reviewed: false,
        });
        report.created++;
      }
      report.proposals.push({ ...p, matchRate: rate, action });
      log(
        `  ${p.fromTable}.${p.fromColumn} → ${p.toTable}.${p.toColumn}` +
          `（重疊率 ${rate === null ? "無法驗證" : (rate * 100).toFixed(0) + "%"}）→ ${action}`,
      );
    }

    if (i + batchSize < sourceTables.length && sleepMs > 0) await sleep(sleepMs);
  }

  return report;
}
