import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getCatalog } from "@/lib/state/catalog";
import { listRules } from "@/lib/state/semanticRules";
import { listRelationships } from "@/lib/state/relationships";
import { qualifiedName } from "@/lib/schema/introspect";

/**
 * Everything the Semantic Layer management page needs. The layer is global/shared
 * (docs/adr/0002), so any authenticated user may read/edit it — no per-user scope.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  try {
    const [catalog, rules, relationships] = await Promise.all([
      getCatalog(),
      listRules(),
      listRelationships(),
    ]);
    // The set of known tables, for the dropdowns in the forms.
    const tables = catalog.map((c) => qualifiedName(c.schema, c.table));
    return NextResponse.json({ catalog, rules, relationships, tables });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
