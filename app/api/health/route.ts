import { NextResponse } from "next/server";
import { verifyConnections } from "@/lib/db";

/** On-demand check of both DB connections. Visit /api/health. */
export async function GET() {
  const checks = await verifyConnections();
  const ok = checks.every((c) => c.configured && "reachable" in c && c.reachable);
  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
