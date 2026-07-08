import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/apiAuth";
import { resolveAnalyticsConfig, resolveProviderConfig } from "@/lib/settings/config";
import { missingProviderKeyForConfig } from "@/lib/llm/factory";

// GET /api/setup/status — is the app configured enough to run? Booleans only (no
// secrets), so any authenticated user can read it to render the setup banner.
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const analytics = await resolveAnalyticsConfig();
  const provider = await resolveProviderConfig();
  return NextResponse.json({
    analyticsConfigured: Boolean(analytics.host),
    providerConfigured: missingProviderKeyForConfig(provider) === null,
    provider: provider.provider,
  });
}
