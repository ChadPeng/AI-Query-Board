// [DEBUG-r7q3] A/B experiment — identical to debug-nomd except maxDuration.
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({ ok: true, variant: "with-maxDuration-60" });
}
