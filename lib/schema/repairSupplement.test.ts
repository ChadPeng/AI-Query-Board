import { describe, expect, it } from "vitest";
import { pickSupplementTables } from "./repairSupplement";

const ACTIVE = ["mepay.orders", "mepay.users", "mepay.user_profiles", "mepay.payments"];

function colsMap(entries: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(entries).map(([t, cols]) => [t, new Set(cols)]));
}

describe("pickSupplementTables", () => {
  it("1054: returns the tables holding the unknown column (qualified prefix stripped)", () => {
    const picked = pickSupplementTables(
      { errno: 1054, message: "Unknown column 'o.nickname' in 'field list'" },
      ACTIVE,
      ["mepay.orders"],
      colsMap({ "mepay.user_profiles": ["nickname", "user_id"] }),
    );
    expect(picked).toEqual(["mepay.user_profiles"]);
  });

  it("1054: skips tables already in the prompt", () => {
    const picked = pickSupplementTables(
      { errno: 1054, message: "Unknown column 'nickname' in 'field list'" },
      ACTIVE,
      ["mepay.user_profiles"],
      colsMap({ "mepay.user_profiles": ["nickname"] }),
    );
    expect(picked).toEqual([]);
  });

  it("1054: refuses generic columns held by >2 tables (would flood the prompt)", () => {
    const picked = pickSupplementTables(
      { errno: 1054, message: "Unknown column 'status' in 'where clause'" },
      ACTIVE,
      [],
      colsMap({
        "mepay.orders": ["status"],
        "mepay.users": ["status"],
        "mepay.payments": ["status"],
      }),
    );
    expect(picked).toEqual([]);
  });

  it("1054: no column map (analytics DB down) → nothing", () => {
    expect(
      pickSupplementTables(
        { errno: 1054, message: "Unknown column 'x'" },
        ACTIVE,
        [],
        null,
      ),
    ).toEqual([]);
  });

  it("1146: resolves an unqualified missing table when unambiguous", () => {
    const picked = pickSupplementTables(
      { errno: 1146, message: "Table 'mepay.user_profile' doesn't exist" },
      ACTIVE,
      ["mepay.orders"],
      null,
    );
    // "user_profile" has no exact match; resolvePickedTable only matches the
    // unqualified name exactly, so this stays empty…
    expect(picked).toEqual([]);
    // …while the exact table name (wrong schema prefix) resolves:
    expect(
      pickSupplementTables(
        { errno: 1146, message: "Table 'analytics.user_profiles' doesn't exist" },
        ACTIVE,
        ["mepay.orders"],
        null,
      ),
    ).toEqual(["mepay.user_profiles"]);
  });

  it("returns nothing for non-schema errors", () => {
    expect(
      pickSupplementTables(
        { errno: 1064, message: "You have an error in your SQL syntax" },
        ACTIVE,
        [],
        null,
      ),
    ).toEqual([]);
  });
});
