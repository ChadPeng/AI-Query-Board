import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { ensureAnalyticsPool } from "@/lib/db";
import { getCatalog } from "@/lib/state/catalog";
import { listRelationships } from "@/lib/state/relationships";
import { listRules } from "@/lib/state/semanticRules";
import { listColumnsInSchemas, type ColumnInfo } from "@/lib/schema/introspect";
import { computeCoverage } from "@/lib/schema/coverage";
import { getRecentFailureStats } from "@/lib/state/queryFailures";

// Knowledge-base health check. Separate from /api/knowledge because it also
// hits the analytics information_schema — keep the main page load fast and
// fetch this lazily when the panel opens.
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  try {
    const [catalog, relationships, rules] = await Promise.all([
      getCatalog(),
      listRelationships(),
      listRules(),
    ]);

    // Schemas come from the catalog itself (not env) so the stats always match
    // what retrieval actually sees. Degrade gracefully without the analytics DB.
    let columns: ColumnInfo[] = [];
    let analyticsAvailable = false;
    if (await ensureAnalyticsPool()) {
      try {
        const schemas = [...new Set(catalog.map((c) => c.schema))];
        columns = await listColumnsInSchemas(schemas);
        analyticsAvailable = true;
      } catch {
        // unreachable / permission error — state-side stats still render
      }
    }

    const coverage = computeCoverage(catalog, relationships, rules, columns, analyticsAvailable);
    const recentFailures = await getRecentFailureStats(7);
    return NextResponse.json({ ...coverage, recentFailures });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
