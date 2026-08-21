import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChartSpec } from "./llm/types";
import type { LLMProvider, SqlChartRequest, SqlChartResponse } from "./llm/provider";

vi.mock("./db", () => ({
  ensureAnalyticsPool: vi.fn(async () => true),
  analyticsPool: () => null,
  statePool: () => null,
}));
vi.mock("./llm/factory", () => ({ getActiveProvider: vi.fn() }));
vi.mock("./schema/retrieval", () => ({
  NoRelevantTablesError: class NoRelevantTablesError extends Error {},
  resolveSchemaForQuestion: vi.fn(),
}));
vi.mock("./analytics/execute", () => ({ executeGuarded: vi.fn() }));
vi.mock("./schema/repairSupplement", () => ({
  supplementDdlForSqlError: vi.fn(async () => undefined),
}));
vi.mock("./state/queryFailures", () => ({
  recordQueryFailure: vi.fn(async () => {}),
}));

import { runEngine } from "./engine";
import { getActiveProvider } from "./llm/factory";
import { resolveSchemaForQuestion } from "./schema/retrieval";
import { executeGuarded } from "./analytics/execute";
import { supplementDdlForSqlError } from "./schema/repairSupplement";
import { recordQueryFailure } from "./state/queryFailures";

const SCHEMA = {
  ddl: "CREATE TABLE `orders` (`a` int, `b` int)",
  tables: ["mepay.orders"],
  usedFallback: false,
  rules: [],
  relationships: [],
  joinPaths: [],
  disconnected: [],
};

const SPEC: ChartSpec = { chart_type: "bar", x: "a", y: ["b"], title: "t", aggregation: "none" };

function gen(sql: string, spec: ChartSpec = SPEC): SqlChartResponse {
  return { sql, chart_spec: spec, explanation: "" };
}

function sqlError(errno: number, message: string) {
  return Object.assign(new Error(message), { errno });
}

let genMock: ReturnType<typeof vi.fn<(req: SqlChartRequest) => Promise<SqlChartResponse>>>;
let provider: LLMProvider;

beforeEach(() => {
  vi.clearAllMocks();
  genMock = vi.fn<(req: SqlChartRequest) => Promise<SqlChartResponse>>();
  provider = {
    selectTables: vi.fn(),
    generateSqlAndChart: genMock,
    describeTable: vi.fn(),
    matchSavedQuestion: vi.fn(),
    learnFromSql: vi.fn(),
  } as unknown as LLMProvider;
  vi.mocked(getActiveProvider).mockResolvedValue({ provider, missingKey: null });
  vi.mocked(resolveSchemaForQuestion).mockResolvedValue(SCHEMA);
  vi.mocked(supplementDdlForSqlError).mockResolvedValue(undefined);
});

describe("runEngine SQL-error self-repair", () => {
  it("feeds the MySQL error back and succeeds on the repaired SQL", async () => {
    genMock
      .mockResolvedValueOnce(gen("SELECT bad FROM t"))
      .mockResolvedValueOnce(gen("SELECT good FROM t"));
    vi.mocked(executeGuarded)
      .mockRejectedValueOnce(sqlError(1054, "Unknown column 'bad' in 'field list'"))
      .mockResolvedValueOnce({ rows: [], columns: ["a", "b"] });

    const result = await runEngine("q");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sql).toBe("SELECT good FROM t");
      expect(result.repaired).toBe(1);
    }
    expect(genMock).toHaveBeenCalledTimes(2);
    const repair = genMock.mock.calls[1][0].repair;
    expect(repair).toMatchObject({
      kind: "sql_error",
      previousSql: "SELECT bad FROM t",
      errorMessage: "Unknown column 'bad' in 'field list'",
    });
    // the repair round leaves a telemetry trace even though the query recovered
    expect(vi.mocked(recordQueryFailure)).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "repair_sql", errno: 1054 }),
    );
  });

  it("passes deterministic supplemental DDL into the repair prompt", async () => {
    vi.mocked(supplementDdlForSqlError).mockResolvedValue("CREATE TABLE `extra` (`x` int)");
    genMock
      .mockResolvedValueOnce(gen("SELECT bad FROM t"))
      .mockResolvedValueOnce(gen("SELECT good FROM t"));
    vi.mocked(executeGuarded)
      .mockRejectedValueOnce(sqlError(1054, "Unknown column 'x' in 'field list'"))
      .mockResolvedValueOnce({ rows: [], columns: ["a", "b"] });

    const result = await runEngine("q");
    expect(result.ok).toBe(true);
    expect(genMock.mock.calls[1][0].repair).toMatchObject({
      kind: "sql_error",
      addedDdl: "CREATE TABLE `extra` (`x` int)",
    });
  });

  it("fails immediately on a non-retryable execution error", async () => {
    genMock.mockResolvedValueOnce(gen("SELECT a FROM t"));
    vi.mocked(executeGuarded).mockRejectedValueOnce(sqlError(1045, "Access denied"));

    const result = await runEngine("q");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("查詢執行失敗");
    expect(genMock).toHaveBeenCalledTimes(1);
  });

  it("fails immediately on a timeout (never re-burns the scan)", async () => {
    genMock.mockResolvedValueOnce(gen("SELECT a FROM t"));
    vi.mocked(executeGuarded).mockRejectedValueOnce(
      Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }),
    );

    const result = await runEngine("q");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("查詢逾時");
    expect(genMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after the shared attempts budget (first try + two repairs)", async () => {
    genMock.mockResolvedValue(gen("SELECT broken FROM t"));
    vi.mocked(executeGuarded).mockRejectedValue(sqlError(1064, "syntax error"));

    const result = await runEngine("q");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("查詢執行失敗");
    expect(genMock).toHaveBeenCalledTimes(3);
  });

  it("still repairs a chart/result mismatch (pre-existing behavior)", async () => {
    const badSpec: ChartSpec = { ...SPEC, y: ["missing"] };
    genMock
      .mockResolvedValueOnce(gen("SELECT a FROM t", badSpec))
      .mockResolvedValueOnce(gen("SELECT a FROM t", { ...SPEC, y: ["a"] }));
    vi.mocked(executeGuarded).mockResolvedValue({ rows: [], columns: ["a"] });

    const result = await runEngine("q");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.repaired).toBe(1);
    expect(genMock.mock.calls[1][0].repair).toMatchObject({
      kind: "chart_mismatch",
      missingFields: ["missing"],
    });
  });
});
