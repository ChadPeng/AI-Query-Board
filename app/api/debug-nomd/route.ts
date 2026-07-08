// [DEBUG-r7q3] A/B experiment — identical to debug-md except no maxDuration.
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ ok: true, variant: "no-maxDuration" });
}
