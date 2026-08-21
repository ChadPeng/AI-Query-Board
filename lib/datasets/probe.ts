import { compileProbeQueries } from "./compile";
import { runGuardedQuery } from "../analytics/execute";
import type { DatasetInput } from "./types";

/**
 * Save-time live probe: every referenced column and every measure condition is
 * exercised against the analytics DB with LIMIT-1 queries (no aggregation, so
 * never a full scan). A MySQL error here is a validation message, not a 500.
 */
export async function probeDatasetInput(input: DatasetInput): Promise<string | null> {
  const model = {
    id: 0,
    name: input.name,
    description: input.description,
    authorId: 0,
    published: input.published,
    tables: input.tables,
    fields: input.fields.map((f, i) => ({ ...f, id: i + 1 })),
  };
  for (const probe of compileProbeQueries(model)) {
    try {
      await runGuardedQuery(probe.sql, { maxRows: 1 });
    } catch (e) {
      return `${probe.label}驗證失敗：${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return null;
}
