// NOTE: not `server-only` — same reasoning as engine.ts (reusable outside Next).
import { createProvider, missingProviderKey } from "./llm/factory";
import { getCatalog } from "./state/catalog";
import { qualifiedName, parseQualified } from "./schema/introspect";
import { createRelationship } from "./state/relationships";
import { createRule, listRules } from "./state/semanticRules";
import type { LearnFromSqlResult } from "./llm/provider";

export interface LearnSummary {
  relationshipsAdded: number;
  rulesAdded: number;
  relationshipsSkipped: number;
  rulesSkipped: number;
  /** the raw model output, so the UI can show what it proposed */
  proposed: LearnFromSqlResult;
}

/**
 * Learn Semantic Layer drafts from example SQL (slice 15). Everything is written
 * reviewed=0 (a draft), consistent with the AI-bootstrap flow (docs/adr/0002):
 * useful immediately, highlighted in the UI for a human to confirm. Drafts that
 * reference tables not in the catalog are dropped (the model may hallucinate).
 */
export async function learnFromSql(sql: string): Promise<LearnSummary> {
  const keyError = missingProviderKey();
  if (keyError) throw new Error(keyError);
  if (!sql.trim()) throw new Error("請貼上至少一段 SQL");

  const catalog = await getCatalog();
  const known = new Set(catalog.map((c) => qualifiedName(c.schema, c.table)));
  const provider = createProvider();

  const proposed = await provider.learnFromSql({
    sql,
    knownTables: [...known],
  });

  let relationshipsAdded = 0;
  let relationshipsSkipped = 0;
  for (const r of proposed.relationships) {
    const from = parseQualified(r.fromTable);
    const to = parseQualified(r.toTable);
    // Drop edges that reference tables we don't know (guard against hallucination).
    if (!from || !to || (known.size > 0 && (!known.has(r.fromTable) || !known.has(r.toTable)))) {
      relationshipsSkipped++;
      continue;
    }
    try {
      await createRelationship({
        fromSchema: from.schema,
        fromTable: from.table,
        fromColumn: r.fromColumn,
        toSchema: to.schema,
        toTable: to.table,
        toColumn: r.toColumn,
        cardinality: r.cardinality,
        reviewed: false,
      });
      relationshipsAdded++;
    } catch {
      relationshipsSkipped++;
    }
  }

  // Dedup rules against what's already stored (and within this batch).
  const existing = new Set(
    (await listRules()).map((r) => `${r.scope}|${r.table ?? ""}|${r.termName ?? ""}|${r.content}`),
  );
  let rulesAdded = 0;
  let rulesSkipped = 0;
  for (const rule of proposed.rules) {
    const table = rule.scope === "table" ? rule.table : null;
    const termName = rule.scope === "term" ? rule.termName ?? "" : "";
    // A table-scoped rule must point at a known table.
    if (rule.scope === "table" && !(table && known.has(table))) {
      rulesSkipped++;
      continue;
    }
    if (rule.scope === "term" && !termName) {
      rulesSkipped++;
      continue;
    }
    const key = `${rule.scope}|${table ?? ""}|${termName}|${rule.content}`;
    if (existing.has(key)) {
      rulesSkipped++;
      continue;
    }
    try {
      await createRule({
        scope: rule.scope,
        termName: rule.scope === "term" ? rule.termName : null,
        table,
        content: rule.content,
        reviewed: false,
      });
      existing.add(key);
      rulesAdded++;
    } catch {
      rulesSkipped++;
    }
  }

  return { relationshipsAdded, rulesAdded, relationshipsSkipped, rulesSkipped, proposed };
}
