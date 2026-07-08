import { describe, it, expect } from "vitest";
import { can, isRole, ROLES } from "./permissions";

describe("can", () => {
  it("lets a viewer only list and run reports", () => {
    expect(can("viewer", "report:list")).toBe(true);
    expect(can("viewer", "report:run")).toBe(true);
    expect(can("viewer", "report:create")).toBe(false);
    expect(can("viewer", "report:edit")).toBe(false);
    expect(can("viewer", "report:delete")).toBe(false);
    expect(can("viewer", "user:manage")).toBe(false);
    expect(can("viewer", "setting:manage")).toBe(false);
  });

  it("lets an editor author reports but not manage users or settings", () => {
    expect(can("editor", "report:create")).toBe(true);
    expect(can("editor", "report:edit")).toBe(true);
    expect(can("editor", "report:delete")).toBe(true);
    expect(can("editor", "user:manage")).toBe(false);
    expect(can("editor", "setting:manage")).toBe(false);
  });

  it("lets a super_admin do everything", () => {
    expect(can("super_admin", "user:manage")).toBe(true);
    expect(can("super_admin", "setting:manage")).toBe(true);
    expect(can("super_admin", "report:create")).toBe(true);
    expect(can("super_admin", "report:run")).toBe(true);
  });

  it("is hierarchical: a higher tier includes everything lower tiers can do", () => {
    const actions = [
      "report:list",
      "report:run",
      "report:create",
      "report:edit",
      "report:delete",
      "user:manage",
      "setting:manage",
    ] as const;
    for (const action of actions) {
      if (can("viewer", action)) expect(can("editor", action)).toBe(true);
      if (can("editor", action)) expect(can("super_admin", action)).toBe(true);
    }
  });
});

describe("isRole", () => {
  it("accepts the three known roles", () => {
    for (const r of ROLES) expect(isRole(r)).toBe(true);
  });
  it("rejects anything else", () => {
    expect(isRole("admin")).toBe(false);
    expect(isRole("")).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(2)).toBe(false);
  });
});
