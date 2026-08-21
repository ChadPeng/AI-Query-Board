import type { InjectedJoinStep, InjectedRule, LLMProvider } from "../llm/provider";
import type { DatasetModel, DatasetTableNode } from "../datasets/types";
import { listDatasets, getDatasetModel } from "../state/datasets";
import { getAlwaysInjectedRules, getTableRules } from "../state/semanticRules";
import { getCreateTablesFor, qualifiedName } from "./introspect";
import type { ResolvedSchema } from "./retrieval";

/**
 * Dataset-first routing (BI 第四波). Before the generic two-stage retrieval,
 * try matching the question to a curated Dataset — an N-choose-1-or-null task
 * weak models handle far better than free table selection. On a hit, stage-1
 * selection AND graph-connect are skipped entirely: the model gets the
 * dataset's tables, its MANDATORY join tree, and the business definitions of
 * every dimension/measure. On a miss (or any error) the caller falls back to
 * the normal path — zero regression risk.
 */

/** Root-to-leaf JOIN chains of the dataset's tree, as injectable steps. */
export function datasetJoinPaths(tables: DatasetTableNode[]): InjectedJoinStep[][] {
  const qualified = (t: DatasetTableNode) => qualifiedName(t.schema, t.table);
  const byAlias = new Map(tables.map((t) => [t.alias, t]));
  const hasChild = new Set(tables.map((t) => t.parentAlias).filter((a): a is string => !!a));
  const leaves = tables.filter((t) => t.parentAlias !== null && !hasChild.has(t.alias));

  const paths: InjectedJoinStep[][] = [];
  for (const leaf of leaves) {
    const steps: InjectedJoinStep[] = [];
    let cur: DatasetTableNode | undefined = leaf;
    while (cur && cur.parentAlias !== null) {
      const parent = byAlias.get(cur.parentAlias);
      if (!parent || !cur.parentColumn || !cur.childColumn) break;
      steps.unshift({
        fromTable: qualified(parent),
        fromColumn: cur.parentColumn,
        toTable: qualified(cur),
        toColumn: cur.childColumn,
        reviewed: true, // curated by an editor — by definition confirmed
      });
      cur = parent;
    }
    if (steps.length > 0) paths.push(steps);
  }
  return paths;
}

/** The dataset's dimensions/measures as authoritative vocabulary rules. */
export function datasetVocabularyRules(model: DatasetModel): InjectedRule[] {
  const rules: InjectedRule[] = [
    {
      scope: "global",
      content:
        `本問題對應資料模型「${model.name}」。使用其 JOIN 樹（見 Verified JOIN paths），` +
        `不得自創其他 JOIN 路徑；度量口徑以下列定義為準。`,
      reviewed: true,
    },
  ];
  for (const f of model.fields) {
    if (f.kind === "measure") {
      const expr =
        f.aggregation === "count" && !f.columnName
          ? "COUNT(*)"
          : `${(f.aggregation ?? "sum").toUpperCase()}(${f.tableAlias}.${f.columnName})`;
      rules.push({
        scope: "global",
        content:
          `度量「${f.name}」= ${expr}` +
          (f.conditionSql ? `，僅計入符合 ${f.conditionSql} 的列` : "") +
          (f.description ? `（${f.description}）` : ""),
        reviewed: true,
      });
    } else {
      rules.push({
        scope: "global",
        content:
          `維度「${f.name}」= ${f.tableAlias}.${f.columnName}` +
          (f.description ? `（${f.description}）` : ""),
        reviewed: true,
      });
    }
  }
  return rules;
}

/** Build a ResolvedSchema from a curated Dataset (no LLM, no graph walk). */
export async function resolveSchemaForDataset(model: DatasetModel): Promise<ResolvedSchema> {
  const tables = [...new Set(model.tables.map((t) => qualifiedName(t.schema, t.table)))];
  const ddl = await getCreateTablesFor(tables);
  if (!ddl.trim()) throw new Error(`資料模型「${model.name}」的表已不存在於分析庫`);

  const [always, tableRules] = await Promise.all([
    getAlwaysInjectedRules(),
    getTableRules(tables),
  ]);
  const semanticRules: InjectedRule[] = [...always, ...tableRules].map((r) => ({
    scope: r.scope,
    termName: r.termName,
    table: r.table,
    content: r.content,
    reviewed: r.reviewed,
  }));

  return {
    ddl,
    tables,
    usedFallback: false,
    rules: [...datasetVocabularyRules(model), ...semanticRules],
    relationships: [],
    joinPaths: datasetJoinPaths(model.tables),
    disconnected: [],
    datasetName: model.name,
  };
}

/**
 * The dataset-first attempt: match → load → resolve. Returns null on no match
 * or ANY failure so the caller's normal retrieval path is never at risk.
 */
export async function tryResolveDatasetSchema(
  question: string,
  provider: LLMProvider,
): Promise<ResolvedSchema | null> {
  try {
    const published = await listDatasets(true);
    if (published.length === 0) return null;
    const id = await provider.matchDataset({
      question,
      candidates: published.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description ?? "",
      })),
    });
    if (id == null) return null;
    const model = await getDatasetModel(id);
    if (!model) return null;
    return await resolveSchemaForDataset(model);
  } catch {
    return null;
  }
}
