import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { deriveKey, encryptSecret } from "./crypto";

// Regression (2026-08-31 prod outage): a secret override sealed under another
// environment's key (or a rotated AUTH_SECRET) fails GCM authentication. That
// must degrade to the env/default fallback — not throw and 500 every caller
// that resolves settings (engine, admin settings page).
vi.mock("../state/settings", () => ({
  getSettingOverrides: vi.fn(),
  upsertSetting: vi.fn(),
  deleteSetting: vi.fn(),
}));

import { getSettingOverrides } from "../state/settings";
import { getSetting } from "./service";

const OTHER_ENV_KEY = deriveKey("some-other-environment-secret");

beforeEach(() => {
  vi.stubEnv("SETTINGS_ENCRYPTION_KEY", "this-environment-secret");
  vi.stubEnv("OLLAMA_API_KEY", "env-fallback-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getSetting with an undecryptable secret override", () => {
  it("falls back to the env value instead of throwing", async () => {
    vi.mocked(getSettingOverrides).mockResolvedValue(
      new Map([["llm.ollama_key", encryptSecret("sealed-elsewhere", OTHER_ENV_KEY)]]),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const r = await getSetting("llm.ollama_key");
    expect(r.value).toBe("env-fallback-key");
    expect(r.source).toBe("env");
    expect(r.dbValue).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("still decrypts overrides sealed under this environment's key", async () => {
    // The service caches the override map for a short TTL — step past it so
    // this test reads its own mocked map, not the previous test's.
    vi.useFakeTimers({ now: Date.now() + 60_000 });
    const mine = deriveKey("this-environment-secret");
    vi.mocked(getSettingOverrides).mockResolvedValue(
      new Map([["llm.ollama_key", encryptSecret("my-real-key", mine)]]),
    );
    const r = await getSetting("llm.ollama_key");
    expect(r.value).toBe("my-real-key");
    expect(r.source).toBe("db");
  });
});
