// [DEBUG-r7q3] Temporary diagnostic route — reports which server module fails to
// initialize on this deployment. Remove after the reports/run 500 is diagnosed.
import { NextResponse } from "next/server";

export const maxDuration = 60;

const MODULES: Record<string, () => Promise<unknown>> = {
  guardrails: () => import("@/lib/guardrails"),
  db: () => import("@/lib/db"),
  "analytics/execute": () => import("@/lib/analytics/execute"),
  "reports/params": () => import("@/lib/reports/params"),
  "reports/csv": () => import("@/lib/reports/csv"),
  "settings/service": () => import("@/lib/settings/service"),
  "state/reports": () => import("@/lib/state/reports"),
  "llm/factory": () => import("@/lib/llm/factory"),
  engine: () => import("@/lib/engine"),
  apiAuth: () => import("@/lib/apiAuth"),
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("t") !== "r7q3-2026") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const results: Record<string, string> = {};
  for (const [name, load] of Object.entries(MODULES)) {
    try {
      await load();
      results[name] = "ok";
    } catch (e) {
      results[name] = `FAIL: ${e instanceof Error ? `${e.message}\n${e.stack}` : String(e)}`;
    }
  }
  return NextResponse.json({
    node: process.version,
    env: {
      REPORT_MAX_ROWS: Boolean(process.env.REPORT_MAX_ROWS),
      GUARDRAIL_MAX_ROWS: Boolean(process.env.GUARDRAIL_MAX_ROWS),
      ANALYTICS_DB_HOST: Boolean(process.env.ANALYTICS_DB_HOST),
      STATE_DB_HOST: Boolean(process.env.STATE_DB_HOST),
      AUTH_SECRET: Boolean(process.env.AUTH_SECRET),
    },
    results,
  });
}
